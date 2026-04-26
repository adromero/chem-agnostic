// Grep-based audit: every user-facing diagnostic message in the modified
// core files must come from tr(...) — no literal strings should survive.
//
// We check checks.ts, import-check.ts, and template-claude-md.ts for the
// most distinctive vocabulary terms ("bond violation", "compound", etc.)
// outside of comments and tr() calls. Allowlists cover legitimate uses
// (e.g. compound: c.manifest.compound — the YAML schema field name).

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const checksPath = path.join(repoRoot, "packages/core/src/checks.ts");
const importCheckPath = path.join(repoRoot, "packages/core/src/import-check.ts");
const templatePath = path.join(repoRoot, "packages/core/src/template-claude-md.ts");

/**
 * Strip line + block comments from a TS source string. Used so that the
 * grep doesn't trip on documentation copy that mentions vocabulary terms.
 */
function stripComments(src: string): string {
  // Remove block comments first
  let out = src.replace(/\/\*[\s\S]*?\*\//g, "");
  // Remove line comments — but only when the // is not inside a string. A
  // robust pass is overkill; in this codebase line comments always start a
  // line (perhaps after whitespace).
  out = out
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
  return out;
}

describe("vocabulary coverage — modified core files do not embed literal user-facing terms", () => {
  it("checks.ts emits diagnostic messages exclusively via tr()", () => {
    const src = stripComments(fs.readFileSync(checksPath, "utf-8"));

    // Each ditched literal phrase from the pre-vocabulary version. None
    // should reappear in the source after the conversion.
    const forbidden = [
      "bond violation",
      "Duplicate compound name",
      "has unknown role",
      "file not found",
      "Compound exports units but has no",
      "path does not contain",
      "has no matching unit with role",
      "which does not exist",
      "but it is not exported",
      "Cannot import",
      "is singleton but has",
      'tests \\"',
      'mocks \\"',
    ];
    for (const phrase of forbidden) {
      expect(src, `checks.ts should not contain literal "${phrase}"`).not.toMatch(
        new RegExp(phrase),
      );
    }
  });

  it("import-check.ts emits diagnostic messages exclusively via tr()", () => {
    const src = stripComments(fs.readFileSync(importCheckPath, "utf-8"));

    const forbidden = [
      "bond violation",
      "but it is not in the imports list",
      "imports directly from",
    ];
    for (const phrase of forbidden) {
      expect(src, `import-check.ts should not contain literal "${phrase}"`).not.toMatch(
        new RegExp(phrase),
      );
    }
  });

  it("template-claude-md.ts builds shared sections via tr()", () => {
    const src = stripComments(fs.readFileSync(templatePath, "utf-8"));

    // The shared sections (intro, roles_table, bond rules, etc.) all live
    // in the locale JSON. The template should reference them by key, not
    // re-implement them inline.
    const forbidden = [
      "Chem Architecture",
      "## Roles — What Each Unit Type Means",
      "## Bond Rules — What Can Depend on What",
      "## Compound Types",
      "## Rules for AI Assistants",
    ];
    for (const phrase of forbidden) {
      expect(src, `template-claude-md.ts should not contain literal "${phrase}"`).not.toContain(
        phrase,
      );
    }

    // It SHOULD still call tr() for the seven required CLAUDE.md keys.
    const required = [
      "claude_md.intro",
      "claude_md.roles_table",
      "claude_md.bonds_table",
      "claude_md.compound_types",
      "claude_md.workflow",
      "claude_md.tool_reference",
      "claude_md.ai_rules",
    ];
    for (const key of required) {
      expect(src, `template-claude-md.ts should call tr("${key}")`).toContain(key);
    }
  });
});
