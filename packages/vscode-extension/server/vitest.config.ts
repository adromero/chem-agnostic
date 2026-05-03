// Server protocol tests run with vitest. The server package depends on
// @chemag/core (a real workspace dep, NOT an alias) and on vscode-languageserver
// and vscode-jsonrpc — none of those need the parent's chemagAliases map.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
