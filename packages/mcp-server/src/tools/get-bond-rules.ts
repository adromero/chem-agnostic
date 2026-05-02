// ---------------------------------------------------------------------------
// `get_bond_rules` — return the workspace's role definitions, bond map,
// compound-type rules, and the cross-compound import policy. Vocabulary
// is selectable via input; defaults to the workspace's active vocabulary.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { setVocabulary, getVocabulary, tr, type VocabularyName } from "@chemag/core/vocabulary";
import type { Session } from "../context.js";
import type { Tool } from "./types.js";

const inputSchema = {
  vocabulary: z.enum(["standard", "chemistry"]).optional(),
};

export interface GetBondRulesOutput {
  roles: Array<{ name: string; description: string; folder: string; vocabulary_label: string }>;
  bonds: Record<string, string[]>;
  compound_types: Record<
    string,
    {
      description: string;
      importable_by?: string;
      can_import?: string[];
      implicit?: boolean;
      singleton?: boolean;
      allowed_roles?: string[];
    }
  >;
  cross_compound_rule: string;
}

export const getBondRulesTool: Tool<typeof inputSchema, GetBondRulesOutput> = {
  name: "get_bond_rules",
  description:
    "Return the workspace's role catalog, bond (dependency) map, compound-type definitions, and the cross-compound import rule. Optional vocabulary override switches the role labels in the output.",
  inputSchema,
  async handler(input, session: Session): Promise<GetBondRulesOutput> {
    const workspace = await session.loadWorkspace();

    // Apply requested vocabulary at the "session" rank for the duration of
    // this call, then restore.
    const previousVocab = getVocabulary();
    const requestedVocab: VocabularyName | undefined = input.vocabulary;
    if (requestedVocab && requestedVocab !== previousVocab) {
      setVocabulary(requestedVocab, "session");
    }
    try {
      const roles = Object.entries(workspace.roles).map(([name, def]) => ({
        name,
        description: def.description,
        folder: def.folder,
        vocabulary_label: tr(`role.${name}` as Parameters<typeof tr>[0]),
      }));

      const compoundTypesRaw = workspace.compound_types ?? {};
      const compoundTypes: GetBondRulesOutput["compound_types"] = {};
      for (const [k, v] of Object.entries(compoundTypesRaw)) {
        compoundTypes[k] = {
          description: v.description,
          ...(v.importable_by ? { importable_by: v.importable_by } : {}),
          ...(v.can_import ? { can_import: v.can_import } : {}),
          ...(v.implicit !== undefined ? { implicit: v.implicit } : {}),
          ...(v.singleton !== undefined ? { singleton: v.singleton } : {}),
          ...(v.allowed_roles ? { allowed_roles: v.allowed_roles } : {}),
        };
      }

      return {
        roles,
        bonds: workspace.bonds,
        compound_types: compoundTypes,
        cross_compound_rule: workspace.rules?.cross_compound_imports ?? "public_only",
      };
    } finally {
      if (requestedVocab && requestedVocab !== previousVocab) {
        setVocabulary(previousVocab, "session");
      }
    }
  },
};
