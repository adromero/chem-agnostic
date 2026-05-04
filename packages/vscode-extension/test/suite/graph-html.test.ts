// ---------------------------------------------------------------------------
// wp-026e: HTML-shape assertions for the show-graph webview scaffold.
//
// These are the assertions formerly inside the Electron test — moved here
// because the bundled extension / source-compiled test dual-module split
// makes Electron-side `lastPanel` capture unreliable. `renderGraphHtml` is
// pure (no vscode runtime), so we exercise it directly with a stub URI and
// stub cspSource.
// ---------------------------------------------------------------------------

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import { renderGraphHtml } from "../../src/webviews/graph-html";

suite("renderGraphHtml (wp-026e)", () => {
  test("produces HTML with mermaid <pre>, fixture compound names, CSP nonce, no remote URLs", () => {
    // A minimal Mermaid source that mentions the fixture's compound names.
    // We don't need real graph CLI output; the helper just embeds whatever
    // string we hand it (after HTML-escape).
    const mermaidSource = "graph LR\n  alpha --> beta\n";

    // Stub URI with a `toString()` matching what `webview.asWebviewUri`
    // would emit for a same-origin asset (vscode-resource scheme variant).
    const scriptUri = vscode.Uri.parse("vscode-resource:/fake/dist/mermaid.js");

    const cspSource = "vscode-resource:";
    const html = renderGraphHtml({
      mermaidSource,
      mermaidScriptUri: scriptUri,
      cspSource,
    });

    // Mermaid container.
    assert.ok(
      html.includes('<pre class="mermaid">'),
      'webview HTML should contain <pre class="mermaid">',
    );

    // Compound labels appear inside the <pre class="mermaid">…</pre> block.
    const preMatch = html.match(/<pre class="mermaid">([\s\S]*?)<\/pre>/);
    assert.ok(preMatch, '<pre class="mermaid"> block should be present');
    const preContents = preMatch[1];
    assert.ok(preContents.includes("alpha"), "mermaid <pre> should reference the alpha compound");
    assert.ok(preContents.includes("beta"), "mermaid <pre> should reference the beta compound");

    // CSP must be emitted with a per-render nonce.
    assert.ok(
      html.includes("Content-Security-Policy"),
      "webview HTML should declare a Content-Security-Policy",
    );
    assert.ok(
      html.includes("script-src 'nonce-"),
      "CSP should constrain script-src to a nonce (no inline / no eval)",
    );

    // No remote sources — every asset is loaded from the webview's own
    // origin via `webview.asWebviewUri`, never a CDN.
    assert.ok(!/https?:\/\//.test(html), "webview HTML must not contain remote http(s):// URLs");
  });
});
