#!/usr/bin/env node
// Copy vocabulary JSON locales into dist/ so that the published package
// resolves them at runtime. tsc does not copy JSON files even with
// resolveJsonModule enabled.

import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const srcDir = resolve(pkgRoot, "src/vocabulary");
const dstDir = resolve(pkgRoot, "dist/vocabulary");

if (!existsSync(srcDir)) {
  console.error(`copy-locales: missing source dir ${srcDir}`);
  process.exit(1);
}
mkdirSync(dstDir, { recursive: true });

let copied = 0;
for (const entry of readdirSync(srcDir)) {
  if (!entry.endsWith(".json")) continue;
  copyFileSync(join(srcDir, entry), join(dstDir, entry));
  copied++;
}

console.log(`copy-locales: copied ${copied} JSON file(s) to ${dstDir}`);
