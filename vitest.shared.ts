// Shared Vitest alias map. Each package's vitest.config.ts re-uses this so
// `@chemag/core/foo` resolves to source files (no build step required for tests).
import { resolve } from "node:path";

export function chemagAliases(repoRoot: string): Record<string, string> {
  const r = (p: string): string => resolve(repoRoot, p);
  return {
    "@chemag/core/plugin-interface": r("packages/core/src/plugin-interface.ts"),
    "@chemag/core/types": r("packages/core/src/types.ts"),
    "@chemag/core/loader": r("packages/core/src/loader.ts"),
    "@chemag/core/checks": r("packages/core/src/checks.ts"),
    "@chemag/core/check-edit": r("packages/core/src/check-edit.ts"),
    "@chemag/core/cache": r("packages/core/src/cache/index.ts"),
    "@chemag/core/import-check": r("packages/core/src/import-check.ts"),
    "@chemag/core/scaffold": r("packages/core/src/scaffold.ts"),
    "@chemag/core/sync": r("packages/core/src/sync.ts"),
    "@chemag/core/graph": r("packages/core/src/graph.ts"),
    "@chemag/core/template-claude-md": r("packages/core/src/template-claude-md.ts"),
    "@chemag/core/rules-emitters": r("packages/core/src/rules-emitters/index.ts"),
    "@chemag/core/vocabulary": r("packages/core/src/vocabulary/index.ts"),
    "@chemag/core/diagnostics": r("packages/core/src/diagnostics/index.ts"),
    "@chemag/core/add-unit": r("packages/core/src/add-unit.ts"),
    "@chemag/core/git-utils": r("packages/core/src/git-utils.ts"),
    "@chemag/core": r("packages/core/src/index.ts"),
    "@chemag/mcp-server": r("packages/mcp-server/src/index.ts"),
    "@chemag/plugin-typescript": r("packages/plugin-typescript/src/index.ts"),
    "@chemag/plugin-python": r("packages/plugin-python/src/index.ts"),
    "@chemag/telemetry": r("packages/telemetry/src/index.ts"),
  };
}
