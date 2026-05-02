// ---------------------------------------------------------------------------
// Resolve the LanguagePlugin for a workspace at runtime.
//
// @chemag/mcp-server declares the language plugins as OPTIONAL peer
// dependencies — keeping that contract means the MCP server can ship in
// a TS-only or Python-only deployment. We dynamically `require` whichever
// plugin the workspace asks for, and surface a helpful error if it's not
// installed.
//
// We use a sync require here (not dynamic import) because the rest of the
// tool surface is synchronous-looking — runCheckEdit is sync, scaffold is
// sync, etc. The plugin is small enough that the eager load is fine.
// ---------------------------------------------------------------------------

import { createRequire } from "node:module";
import type { LanguagePlugin } from "@chemag/core/plugin-interface";
import type { Workspace } from "@chemag/core/types";

const requireFromHere = createRequire(import.meta.url);

const PLUGIN_PACKAGE_FOR: Record<string, string> = {
  typescript: "@chemag/plugin-typescript",
  python: "@chemag/plugin-python",
};

const PLUGIN_EXPORT_FOR: Record<string, string> = {
  typescript: "typescriptPlugin",
  python: "pythonPlugin",
};

/**
 * Load the language plugin declared by `workspace.language`. Throws a
 * descriptive `Error` when the plugin package is not installed in the
 * current project.
 */
export function resolvePlugin(workspace: Workspace): LanguagePlugin {
  const language = workspace.language;
  const pkg = PLUGIN_PACKAGE_FOR[language];
  if (!pkg) {
    throw new Error(
      `Unsupported workspace language "${language}". ` +
        `Known languages: ${Object.keys(PLUGIN_PACKAGE_FOR).join(", ")}`,
    );
  }
  let mod: Record<string, LanguagePlugin>;
  try {
    mod = requireFromHere(pkg) as Record<string, LanguagePlugin>;
  } catch {
    throw new Error(
      `Workspace declares language "${language}" but ${pkg} is not installed. Install it as a peer dependency.`,
    );
  }
  const exportName = PLUGIN_EXPORT_FOR[language];
  const plugin = mod[exportName];
  if (!plugin) {
    throw new Error(`${pkg} loaded but does not export "${exportName}".`);
  }
  return plugin;
}
