import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { chemagAliases } from "../../vitest.shared";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

export default defineConfig({
  resolve: {
    alias: chemagAliases(repoRoot),
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
    hookTimeout: 30000,
    // Exclude fixture trees — some fixtures intentionally contain `*.test.ts`
    // files (e.g. semantic-rules/port-003/valid/test-exemption) used as inputs
    // to the analyze phase, not as real vitest suites.
    exclude: ["**/node_modules/**", "**/dist/**", "test/fixtures/**"],
  },
});
