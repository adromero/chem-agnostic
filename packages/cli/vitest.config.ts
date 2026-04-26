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
    // `.bench.ts` runs as part of the regular suite — it asserts on
    // duration thresholds rather than producing benchmark reports.
    include: ["test/**/*.test.ts", "test/**/*.bench.ts"],
    testTimeout: 30_000,
  },
});
