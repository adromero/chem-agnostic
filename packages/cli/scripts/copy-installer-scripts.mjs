#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Post-build helper: copy installer fallback shell scripts into dist/ so the
// published package ships them alongside the compiled installers.
//
// Layout:
//   src/installers/scripts/{chemag-pre-edit,chemag-post-edit}.sh
//     → dist/installers/scripts/...
//
// `tsc` does not copy non-.ts files. We mirror the small directory by hand.
// Idempotent: overwrites existing dist files.
// ---------------------------------------------------------------------------
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, "..", "src", "installers", "scripts");
const distDir = resolve(here, "..", "dist", "installers", "scripts");

if (!existsSync(srcDir)) {
  console.log(`copy-installer-scripts: ${srcDir} does not exist; nothing to do`);
  process.exit(0);
}

mkdirSync(distDir, { recursive: true });

const entries = readdirSync(srcDir);
for (const name of entries) {
  const dst = resolve(distDir, name);
  copyFileSync(resolve(srcDir, name), dst);
  if (name.endsWith(".sh")) chmodSync(dst, 0o755);
}
console.log(`copy-installer-scripts: copied ${entries.length} file(s) to ${distDir}`);
