// ---------------------------------------------------------------------------
// `where_should_this_go` — heuristic placement suggestions for a free-form
// description (or a file-path-shaped string).
//
// Implementation strategy:
//   1. If the description is path-shaped, short-circuit to
//      `resolveFilePlacement` and return a single high-confidence suggestion.
//   2. Otherwise, score each (compound, role) pair via TF-IDF over the
//      compound description + role definition vs. the user's description.
//      Lightweight, in-package — no external NLP dep. Returns top-K
//      suggestions with confidence in [0, 1] and a short rationale.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { resolveFilePlacement } from "@chemag/core/check-edit";
import type { Workspace, LoadedCompound } from "@chemag/core/types";
import type { Session } from "../context.js";
import { resolvePlugin } from "./plugin-resolver.js";
import type { Tool } from "./types.js";

const inputSchema = {
  description: z.string().min(1, "description is required"),
  intent_hint: z.enum(["domain", "infrastructure", "workflow", "contract"]).optional(),
};

/** Mapping of `intent_hint` values to roles that match the intent. */
const INTENT_TO_ROLES: Record<string, string[]> = {
  domain: ["element", "molecule"],
  infrastructure: ["adapter"],
  workflow: ["reaction", "buffer"],
  contract: ["interface"],
};

export interface PlacementSuggestion {
  compound: string;
  role: string;
  confidence: number;
  rationale: string;
  nearest_existing_units: string[];
}

export interface WhereShouldThisGoOutput {
  suggestions: PlacementSuggestion[];
}

export const whereShouldThisGoTool: Tool<typeof inputSchema, WhereShouldThisGoOutput> = {
  name: "where_should_this_go",
  description:
    "Suggest one or more (compound, role) placements for a free-form feature description, or resolve a file path to its (compound, role) directly. Returns ranked suggestions with rationales drawn from existing units.",
  inputSchema,
  async handler(input, session: Session): Promise<WhereShouldThisGoOutput> {
    const workspace = await session.loadWorkspace();
    const compounds = await session.listCompounds();
    const plugin = resolvePlugin(workspace);

    // Path-shaped short-circuit: any forward slash + recognized extension
    // (or workspace-relative path that resolves) routes through
    // `resolveFilePlacement`.
    const looksLikePath =
      /\.(ts|tsx|js|mjs|cjs|py|rb|go|rs|java|kt|cs)$/i.test(input.description) ||
      input.description.includes("/");
    if (looksLikePath) {
      const hit = resolveFilePlacement(workspace, session.workspaceDir, input.description, plugin);
      if (hit) {
        return {
          suggestions: [
            {
              compound: hit.compound,
              role: hit.role,
              confidence: 1,
              rationale: `Path "${input.description}" resolves to compound "${hit.compound}" / role "${hit.role}" via the workspace's role-folder map.`,
              nearest_existing_units: nearestUnitsIn(compounds, hit.compound, hit.role),
            },
          ],
        };
      }
      // Path-shaped but unresolved — fall through to TF-IDF.
    }

    // TF-IDF scoring.
    const queryTokens = tokenize(input.description);
    if (queryTokens.length === 0) {
      return { suggestions: [] };
    }

    const docs = buildCorpus(workspace, compounds);
    const idf = computeIdf(docs);

    type Scored = { docId: string; compound: string; role: string; score: number };
    const scored: Scored[] = [];
    for (const doc of docs) {
      const score = cosineScore(queryTokens, doc.tokens, idf);
      if (score > 0) {
        scored.push({ docId: doc.id, compound: doc.compound, role: doc.role, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);

    // Apply intent_hint as a soft boost: if the suggested role matches the
    // hint, multiply its score by 1.5 and re-sort. This way a strong textual
    // match for an off-intent role can still win.
    if (input.intent_hint) {
      const allowed = new Set(INTENT_TO_ROLES[input.intent_hint] ?? []);
      for (const s of scored) {
        if (allowed.has(s.role)) s.score *= 1.5;
      }
      scored.sort((a, b) => b.score - a.score);
    }

    // Normalize confidences to [0, 1] using the top score, capped at 1.
    const topRaw = scored[0]?.score ?? 0;
    const norm = (raw: number): number => {
      if (topRaw === 0) return 0;
      return Math.min(1, raw / topRaw);
    };

    const top = scored.slice(0, 5).map((s) => ({
      compound: s.compound,
      role: s.role,
      confidence: Number(norm(s.score).toFixed(3)),
      rationale: rationaleFor(s.compound, s.role, workspace, queryTokens),
      nearest_existing_units: nearestUnitsIn(compounds, s.compound, s.role),
    }));

    return { suggestions: top };
  },
};

// ---------------------------------------------------------------------------
// TF-IDF helpers
// ---------------------------------------------------------------------------

interface CorpusDoc {
  id: string;
  compound: string;
  role: string;
  tokens: string[];
}

function buildCorpus(workspace: Workspace, compounds: LoadedCompound[]): CorpusDoc[] {
  const docs: CorpusDoc[] = [];
  for (const c of compounds) {
    const compoundText = `${c.manifest.compound} ${c.manifest.description ?? ""}`;
    for (const role of Object.keys(workspace.roles)) {
      const roleDef = workspace.roles[role];
      const unitsForRole = (c.manifest.units ?? [])
        .filter((u) => u.role === role)
        .map((u) => u.name)
        .join(" ");
      const text = [compoundText, role, roleDef.description, unitsForRole]
        .filter(Boolean)
        .join(" ");
      docs.push({
        id: `${c.manifest.compound}::${role}`,
        compound: c.manifest.compound,
        role,
        tokens: tokenize(text),
      });
    }
  }
  return docs;
}

function computeIdf(docs: CorpusDoc[]): Map<string, number> {
  const df = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set(d.tokens);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const N = Math.max(1, docs.length);
  const idf = new Map<string, number>();
  for (const [t, freq] of df) {
    idf.set(t, Math.log(1 + N / (1 + freq)));
  }
  return idf;
}

function cosineScore(query: string[], doc: string[], idf: Map<string, number>): number {
  const qVec = tfIdfVec(query, idf);
  const dVec = tfIdfVec(doc, idf);
  let dot = 0;
  for (const [t, qw] of qVec) {
    const dw = dVec.get(t);
    if (dw !== undefined) dot += qw * dw;
  }
  const qNorm = vecNorm(qVec);
  const dNorm = vecNorm(dVec);
  if (qNorm === 0 || dNorm === 0) return 0;
  return dot / (qNorm * dNorm);
}

function tfIdfVec(tokens: string[], idf: Map<string, number>): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const out = new Map<string, number>();
  for (const [t, count] of tf) {
    out.set(t, count * (idf.get(t) ?? Math.log(2)));
  }
  return out;
}

function vecNorm(v: Map<string, number>): number {
  let s = 0;
  for (const w of v.values()) s += w * w;
  return Math.sqrt(s);
}

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "the",
  "to",
  "of",
  "for",
  "with",
  "in",
  "on",
  "is",
  "are",
  "be",
  "or",
  "as",
  "by",
  "that",
  "this",
  "it",
  "from",
  "at",
  "add",
  "new",
  "create",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && t.length > 1 && !STOPWORDS.has(t));
}

function rationaleFor(
  compound: string,
  role: string,
  workspace: Workspace,
  queryTokens: string[],
): string {
  const roleDef = workspace.roles[role];
  const overlap = queryTokens.filter((t) => roleDef.description.toLowerCase().includes(t));
  if (overlap.length > 0) {
    return `Compound "${compound}" / role "${role}" — keywords [${overlap.join(", ")}] match the role description "${roleDef.description}".`;
  }
  return `Compound "${compound}" / role "${role}" — best textual match against compound + role definitions.`;
}

function nearestUnitsIn(compounds: LoadedCompound[], compoundName: string, role: string): string[] {
  const c = compounds.find((c) => c.manifest.compound === compoundName);
  if (!c) return [];
  return (c.manifest.units ?? [])
    .filter((u) => u.role === role)
    .map((u) => u.name)
    .slice(0, 5);
}
