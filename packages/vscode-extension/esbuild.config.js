// ---------------------------------------------------------------------------
// esbuild build script for the chemag VS Code extension.
//
// Produces THREE bundles inside `dist/`:
//
//   1. `dist/extension.js` — the extension itself. The VS Code runtime injects
//      the `vscode` module, so it is the only entry in `external`. All
//      monorepo siblings (@chemag/core) and runtime deps (@modelcontextprotocol/sdk)
//      are inlined — the installed extension has no `node_modules` access to
//      the workspace. Hard size budget: < 1 MB.
//
//   2. `dist/server.js` — the chemag LSP server, sourced from
//      `@chemag/lsp-server`. We deliberately bundle the lsp-server's
//      TypeScript SOURCE (resolved via the pnpm workspace symlink at
//      `node_modules/@chemag/lsp-server/src/server.ts`) rather than re-bundling
//      its already-self-contained `dist/server.js`. Re-bundling a minified
//      CJS bundle would double-inline every transitive dep and risks blowing
//      the <1 MB size budget the .vsix's LSP server target enforces.
//
//      This mirrors the canonical bundling logic in
//      `packages/lsp-server/scripts/build.js` (same `external: []`, same
//      `format: "cjs"`, same minification policy) so the two outputs stay
//      byte-equivalent up to the location difference.
//
//   3. `dist/mermaid.js` — the Mermaid diagram renderer, bundled as a
//      browser-targeted IIFE for use inside the "Show graph" webview
//      (wp-026e). Mermaid is browser-only ESM that touches `document` /
//      `window` at module-eval, so it CANNOT be inlined into `extension.js`
//      (which is `platform: "node"` + `format: "cjs"`). Targeting the
//      browser + IIFE produces a self-contained file that exposes a
//      `window.mermaid` global the inline `<script>` in the webview HTML
//      can call. Expected size: ~1.5–3 MB. No size cap — it ships
//      separately and only loads when the user opens the graph webview.
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
const extensionOptions = {
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

// Resolve the lsp-server source via the workspace path. We deliberately use
// a relative path through `packages/` (siblings under the same monorepo
// root) instead of `require.resolve("@chemag/lsp-server/src/server.ts")`
// because the lsp-server package's `exports` map does not expose `./src/*`
// (and we don't want it to — `src/` is not a published surface). The
// pnpm workspace dep on `@chemag/lsp-server` (declared in package.json)
// keeps Turbo's `^build` order honest; the path below just tells esbuild
// where the source lives.
const lspServerEntry = path.resolve(__dirname, "..", "lsp-server", "src", "server.ts");

/** @type {import('esbuild').BuildOptions} */
const serverOptions = {
  entryPoints: [lspServerEntry],
  outfile: path.join(__dirname, "dist/server.js"),
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  // Self-contained: nothing external. The server runs inside the .vsix's
  // sandbox where no other node_modules are available — same constraint as
  // packages/lsp-server/scripts/build.js.
  external: [],
  sourcemap: true,
  minify: !dev,
  logLevel: "info",
};

// Resolve mermaid's pre-bundled browser ESM entry. The package's default
// `module` field points at `mermaid.core.mjs`, which keeps langium /
// vscode-jsonrpc / vscode-languageserver-protocol as runtime imports — those
// aren't installed because mermaid pulls them in as dependencies but expects
// the consumer to provide a browser-compatible bundle. The pre-bundled
// `mermaid.esm.mjs` artifact has every diagram parser inlined into chunk
// files alongside it, which esbuild then re-bundles into a single IIFE.
const mermaidEntry = path.join(
  path.dirname(require.resolve("mermaid/package.json")),
  "dist",
  "mermaid.esm.mjs",
);

/** @type {import('esbuild').BuildOptions} */
const mermaidWebviewOptions = {
  // The entry-point object form makes esbuild emit `dist/mermaid.js` (key +
  // `.js`).
  entryPoints: { mermaid: mermaidEntry },
  outdir: path.join(__dirname, "dist"),
  bundle: true,
  // Webview content runs in an isolated Chromium-derived context, NOT in
  // node. We must target the browser so esbuild does not inject `require`
  // shims or treat node built-ins as externals.
  platform: "browser",
  target: "es2020",
  // IIFE so the resulting `dist/mermaid.js` exposes a global (`window.mermaid`)
  // that the inline <script> in the webview HTML can call.
  format: "iife",
  globalName: "mermaid",
  // No source map for the webview asset — keeps the .vsix smaller and the
  // webview has no debugger UI anyway.
  sourcemap: false,
  minify: true,
  // The webview asset is rendered, not executed by node. Nothing external.
  external: [],
  logLevel: "info",
};

async function run() {
  if (watch) {
    const extCtx = await esbuild.context(extensionOptions);
    const srvCtx = await esbuild.context(serverOptions);
    const mermaidCtx = await esbuild.context(mermaidWebviewOptions);
    await Promise.all([extCtx.watch(), srvCtx.watch(), mermaidCtx.watch()]);
    console.log("[esbuild] watching extension + server + mermaid bundles for changes...");
  } else {
    await Promise.all([
      esbuild.build(extensionOptions),
      esbuild.build(serverOptions),
      esbuild.build(mermaidWebviewOptions),
    ]);
    console.log(
      `[esbuild] built ${path.relative(process.cwd(), extensionOptions.outfile)}, ${path.relative(
        process.cwd(),
        serverOptions.outfile,
      )}, and ${path.relative(process.cwd(), path.join(mermaidWebviewOptions.outdir, "mermaid.js"))}`,
    );
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
