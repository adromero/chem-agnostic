// ---------------------------------------------------------------------------
// HTML scaffold for the chemag "Show graph" webview (wp-026e).
//
// Renders the supplied Mermaid source inside a `<pre class="mermaid">` block
// and loads `dist/mermaid.js` (the IIFE webview bundle produced by the third
// esbuild pass — see `esbuild.config.js`). The IIFE exposes `window.mermaid`,
// which the inline script then calls to render the diagram.
//
// Security:
//   - A per-render nonce gates ALL script execution. The nonce is generated
//     via `crypto.randomBytes(16).toString('hex')`, giving a 32-char
//     alphanumeric string per call.
//   - The CSP forbids remote sources (`default-src 'none'`), allows scripts
//     only via the nonce + `${cspSource}` (i.e. the webview's own origin
//     emitted by `panel.webview.asWebviewUri`), and blocks inline event
//     handlers entirely.
//   - The Mermaid source is HTML-escaped before injection so user-supplied
//     compound / unit names cannot break out of the `<pre>` and inject
//     arbitrary markup.
// ---------------------------------------------------------------------------

import * as crypto from "node:crypto";
import type * as vscode from "vscode";

export interface RenderGraphHtmlOptions {
  mermaidSource: string;
  mermaidScriptUri: vscode.Uri;
  cspSource: string;
}

export function renderGraphHtml(opts: RenderGraphHtmlOptions): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const escapedSource = escapeHtml(opts.mermaidSource);
  const scriptUri = String(opts.mermaidScriptUri);
  const cspSource = opts.cspSource;

  // CSP exactly as specified in the stage spec — no remote origins, no CDN.
  // `style-src 'unsafe-inline'` is required because Mermaid injects its own
  // styles inline at render time.
  const csp = [
    "default-src 'none'",
    `style-src ${cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}' ${cspSource}`,
    `img-src ${cspSource} data:`,
    `font-src ${cspSource}`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>chemag graph</title>
<style>
  body { margin: 0; padding: 1rem; font-family: var(--vscode-font-family, sans-serif); }
  pre.mermaid { white-space: pre; overflow: auto; }
</style>
</head>
<body>
<pre class="mermaid">${escapedSource}</pre>
<script nonce="${nonce}" src="${scriptUri}"></script>
<script nonce="${nonce}">
  // Mermaid v10+: explicit run() is more deterministic than startOnLoad and
  // lets us catch render errors. The mermaid global is the IIFE export from
  // dist/mermaid.js (see esbuild.config.js -- globalName: "mermaid"). The
  // bundle exposes the namespace under mermaid.default, so unwrap if present.
  (function () {
    var m = (typeof mermaid !== "undefined" && mermaid && mermaid.default) ? mermaid.default : mermaid;
    if (!m || typeof m.initialize !== "function") return;
    m.initialize({ startOnLoad: false, theme: "default" });
    if (typeof m.run === "function") {
      m.run({ querySelector: "pre.mermaid" });
    }
  })();
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
