// ---------------------------------------------------------------------------
// esbuild build script for the chemag VS Code extension.
//
// Produces a single CJS bundle at dist/extension.js suitable for shipping
// inside a `.vsix`. The VS Code runtime injects the `vscode` module, so it
// is the only entry in `external`. All monorepo siblings (@chemag/core) and
// runtime deps (@modelcontextprotocol/sdk) are inlined — the installed
// extension has no `node_modules` access to the workspace.
//
// Usage:
//   node esbuild.config.js          # production build (minified)
//   node esbuild.config.js --watch  # incremental rebuild for dev
// ---------------------------------------------------------------------------

const esbuild = require("esbuild");
const path = require("node:path");

const watch = process.argv.includes("--watch");
const dev = watch || process.env.NODE_ENV === "development";

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: [path.join(__dirname, "src/extension.ts")],
  outfile: path.join(__dirname, "dist/extension.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // The VS Code runtime injects this module. Everything else is inlined so
  // the .vsix has no transitive node_modules dependency.
  external: ["vscode"],
  sourcemap: true,
  minify: !dev,
  // Resolve workspace siblings via Node module resolution; pnpm symlinks
  // them into node_modules so esbuild picks them up automatically.
  logLevel: "info",
};

async function run() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("[esbuild] watching for changes...");
  } else {
    await esbuild.build(options);
    console.log(`[esbuild] built ${path.relative(process.cwd(), options.outfile)}`);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
