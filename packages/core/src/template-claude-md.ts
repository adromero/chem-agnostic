// ---------------------------------------------------------------------------
// `generateClaudeMd(name, plugin)` — backwards-compatible shim around the
// `rules-emitters/claude-md.ts` module. The CLI's `init` command continues
// to import `generateClaudeMd` from `@chemag/core/template-claude-md`; this
// file routes those calls through the new emitter pipeline so we get one
// canonical CLAUDE.md generator without breaking existing call sites.
//
// `extractLanguageSection` and `CORE_HEADINGS` were relocated to
// `rules-emitters/claude-md.ts`; they are re-exported below for any
// external consumer that still imports them by name.
// ---------------------------------------------------------------------------

import type { LanguagePlugin } from "./plugin-interface.js";
import { buildRulesContent } from "./rules-emitters/index.js";
import { emitClaudeMd } from "./rules-emitters/claude-md.js";
import type { Workspace } from "./types.js";

/**
 * Generate the full CLAUDE.md content for a workspace.
 *
 * Combines the language-agnostic chemag block (via `buildRulesContent` and
 * `emitClaudeMd`) with the plugin-contributed language section. The active
 * vocabulary is read from module-global vocabulary state — callers control
 * the locale via `setVocabulary` / `applyWorkspaceVocabulary` before
 * invoking this function.
 *
 * Signature preserved: `generateClaudeMd(name, plugin)` continues to work
 * for `cli/src/commands/init.ts` without modification.
 */
export function generateClaudeMd(name: string, plugin: LanguagePlugin): string {
  // The shim builds a minimal Workspace shape from the name alone — the
  // legacy generator never enumerated compounds or read workspace.bonds for
  // its output (it pulled the rule tables from vocabulary keys). We stay
  // compatible by feeding `buildRulesContent` an empty compound list and a
  // synthetic Workspace whose roles/bonds derive from the default chem
  // shape; the shared body uses workspace.bonds for the dependency table,
  // so we cannot pass an empty `bonds`. We replicate the legacy default
  // here.
  const workspace = buildLegacyDefaultWorkspace(name);
  const content = buildRulesContent(workspace, []);
  const pluginContent = plugin.generateClaudeMd(name);
  const result = emitClaudeMd(content, { pluginContent });
  return result.body;
}

/**
 * The legacy `generateClaudeMd` did not consult `workspace.yaml` — it
 * generated a static template from vocabulary keys. To keep behaviour
 * stable we fabricate the same default rules used by `init`'s
 * `buildDefaultWorkspace` (see `cli/src/commands/init.ts`).
 */
function buildLegacyDefaultWorkspace(name: string): Workspace {
  return {
    workspace: name,
    language: "typescript",
    roles: {
      element: { description: "Immutable value object", folder: "elements" },
      molecule: { description: "Domain state", folder: "molecules" },
      reaction: { description: "Workflow", folder: "reactions" },
      interface: { description: "Contract", folder: "interfaces" },
      adapter: { description: "Concrete implementation", folder: "adapters" },
      buffer: { description: "Middleware", folder: "buffers" },
    },
    bonds: {
      element: ["element"],
      molecule: ["element", "molecule"],
      reaction: ["element", "molecule", "interface"],
      interface: ["element", "molecule"],
      adapter: ["element", "molecule", "interface", "adapter"],
      buffer: ["element", "molecule", "interface"],
    },
    paths: { compounds: "./src/compounds" },
    rules: {
      cross_compound_imports: "public_only",
      role_from_path: true,
      public_surface: "public.ts",
      manifest_filename: "compound.yaml",
    },
  };
}

// `CORE_HEADINGS` and `extractLanguageSection` were relocated to
// `@chemag/core/rules-emitters`. They are no longer re-exported from this
// shim — there are no external consumers (verified by `grep` at WP-009 time).
