#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Post-build helper: copy completion scripts into dist/ so the published
// package can resolve them from the compiled `commands/completion.js`.
//
// Layout:
//   src/completions/{bash.sh,zsh.sh,fish.fish}  →  dist/completions/...
//
// `tsc` does not copy non-.ts files. We mirror the small directory by hand.
// Idempotent: overwrites existing dist files.
// ---------------------------------------------------------------------------
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, "..", "src", "completions");
const distDir = resolve(here, "..", "dist", "completions");

mkdirSync(distDir, { recursive: true });

const entries = readdirSync(srcDir);
for (const name of entries) {
  copyFileSync(resolve(srcDir, name), resolve(distDir, name));
}
console.log(`copy-completions: copied ${entries.length} file(s) to ${distDir}`);
