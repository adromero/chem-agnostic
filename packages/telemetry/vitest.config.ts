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
    testTimeout: 15_000,
  },
});
