// ---------------------------------------------------------------------------
// `architecture://docs/{section}` — markdown-rendered documentation excerpts
// pulled from the same shared content builder used by `chemag emit-rules`
// (WP-009). Sections:
//
//   roles      → workspace.roles rendered as `| Role | Allowed bonds |` table
//   bonds      → RulesContent.dependencyRulesTable verbatim
//   types      → workspace.compound_types rendered as `| Type | Description |`
//   workflow   → RulesContent.toolingPointer verbatim
//   tools      → bulleted list pulled from ALL_TOOLS at render time
//   ai_rules   → RulesContent.crossModuleRule + DEFAULT_PATHS pointer
//
// Unknown sections raise `ResourceDocsSectionUnknownError` (CHEM-MCP-303).
// The error type is exported so the resource-registry layer can map it onto
// an MCP error response.
//
// Cross-package import: `@chemag/core/rules-emitters` is imported here. Both
// modules ship in the same process; no transitive dep loop.
// ---------------------------------------------------------------------------

import { buildRulesContent, DEFAULT_PATHS } from "@chemag/core/rules-emitters";
import { tr } from "@chemag/core/vocabulary";
import type { Session } from "../context.js";
import { ALL_TOOLS } from "../tools/index.js";

export const DOCS_URI_TEMPLATE = "architecture://docs/{section}";

export const DOCS_SECTIONS = ["roles", "bonds", "types", "workflow", "tools", "ai_rules"] as const;

export type DocsSection = (typeof DOCS_SECTIONS)[number];

export function docsUri(section: string): string {
  return `architecture://docs/${section}`;
}

/** Internal error type used to signal a 303 to the caller layer. */
export class ResourceDocsSectionUnknownError extends Error {
  readonly code = "CHEM-MCP-303" as const;
  readonly section: string;
  constructor(section: string) {
    super(
      tr("diagnostic.resource_docs_section_unknown", {
        section,
        supported: DOCS_SECTIONS.join(", "),
      }),
    );
    this.name = "ResourceDocsSectionUnknownError";
    this.section = section;
  }
}

export async function readDocs(
  session: Session,
  section: string,
): Promise<{ uri: string; mimeType: string; text: string }> {
  if (!isKnownSection(section)) {
    throw new ResourceDocsSectionUnknownError(section);
  }
  const ws = await session.loadWorkspace();
  const compounds = await session.listCompounds();
  const content = buildRulesContent(ws, compounds);

  let body: string;
  switch (section) {
    case "roles":
      body = renderRoles(ws.roles, ws.bonds);
      break;
    case "bonds":
      body = `## Dependency rules\n\n${content.dependencyRulesTable}\n`;
      break;
    case "types":
      body = renderTypes(ws.compound_types);
      break;
    case "workflow":
      body = `## Workflow\n\n${content.toolingPointer}\n`;
      break;
    case "tools":
      body = renderTools();
      break;
    case "ai_rules":
      body = renderAiRules(content.crossModuleRule);
      break;
  }

  return {
    uri: docsUri(section),
    mimeType: "text/markdown",
    text: body,
  };
}

function isKnownSection(s: string): s is DocsSection {
  return (DOCS_SECTIONS as readonly string[]).includes(s);
}

function renderRoles(
  roles: Record<string, { description: string; folder: string }>,
  bonds: Record<string, string[]>,
): string {
  const lines: string[] = [];
  lines.push("## Roles\n");
  lines.push("| Role | Allowed bonds |");
  lines.push("|------|---------------|");
  for (const role of Object.keys(roles)) {
    const allowed = bonds[role] ?? [];
    const cell = allowed.length === 0 ? "(none)" : allowed.join(", ");
    lines.push(`| ${role} | ${cell} |`);
  }
  return `${lines.join("\n")}\n`;
}

function renderTypes(types: Record<string, { description: string }> | undefined): string {
  const lines: string[] = [];
  lines.push("## Compound types\n");
  if (!types || Object.keys(types).length === 0) {
    lines.push("_(no compound types defined in this workspace)_");
    return `${lines.join("\n")}\n`;
  }
  lines.push("| Type | Description |");
  lines.push("|------|-------------|");
  for (const [name, def] of Object.entries(types)) {
    lines.push(`| ${name} | ${def.description ?? ""} |`);
  }
  return `${lines.join("\n")}\n`;
}

function renderTools(): string {
  const lines: string[] = [];
  lines.push("## MCP tools\n");
  for (const tool of ALL_TOOLS) {
    lines.push(`- \`${tool.name}\` — ${tool.description}`);
  }
  return `${lines.join("\n")}\n`;
}

function renderAiRules(crossModuleRule: string): string {
  const lines: string[] = [];
  lines.push("## AI rules\n");
  lines.push(crossModuleRule);
  lines.push("");
  lines.push(
    `See \`${DEFAULT_PATHS.claude}\` and \`${DEFAULT_PATHS.agents}\` for the full rules emitted by \`chemag emit-rules\`.`,
  );
  return `${lines.join("\n")}\n`;
}
