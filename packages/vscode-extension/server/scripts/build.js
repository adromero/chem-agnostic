// ---------------------------------------------------------------------------
// esbuild build script for the chemag LSP server.
//
// Bundles src/server.ts into dist/server.js as a self-contained CJS module.
// The server is spawned as a child process from inside the .vsix; everything
// it needs (vscode-languageserver, vscode-languageserver-textdocument,
// @chemag/core, and the language plugins) must be inlined since the spawned
// process has no node_modules access.
//
// Usage:
//   node scripts/build.js
//   node scripts/build.js --watch
// ---------------------------------------------------------------------------

const esbuild = require("esbuild");
const path = require("node:path");

const watch = process.argv.includes("--watch");
const dev = watch || process.env.NODE_ENV === "development";

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.resolve(__dirname, "..", "src", "server.ts")],
  outfile: path.resolve(__dirname, "..", "dist", "server.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // Self-contained: nothing external. The server runs inside the .vsix's
  // sandbox where no other node_modules are available.
  external: [],
  sourcemap: true,
  minify: !dev,
  logLevel: "info",
};

async function run() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("[esbuild:server] watching for changes...");
  } else {
    await esbuild.build(options);
    console.log(`[esbuild:server] built ${path.relative(process.cwd(), options.outfile)}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
