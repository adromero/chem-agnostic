// ---------------------------------------------------------------------------
// wp-026e: `chemag.showGraph` webview test.
//
// Asserts that executing the command opens a `vscode.WebviewPanel` whose HTML
// contains:
//   - The `<pre class="mermaid">` block expected by the inline mermaid runner.
//   - Both fixture compound names (`alpha` and `beta`) inside that block.
//   - A `Content-Security-Policy` meta header with a per-render nonce.
//   - No remote `http://` / `https://` URLs (CSP forbids them; this is a
//     belt-and-braces check on the markup).
//
// Discovery: `lastPanel` is exported as a module-level binding from
// `../src/commands/show-graph` so the test can reach in without depending
// on a non-existent `vscode.window.activeWebview` API.
// ---------------------------------------------------------------------------

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

import * as showGraph from "../../src/commands/show-graph";

const EXTENSION_ID = "chemag.chemag-vscode";

suite("chemag.showGraph webview", () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} should be discoverable`);
    if (!ext.isActive) {
      await ext.activate();
    }
  });

  teardown(() => {
    // Best-effort cleanup so successive tests don't pile up panels.
    showGraph.lastPanel?.dispose();
  });

  test("executes chemag.showGraph and renders a mermaid webview", async () => {
    await vscode.commands.executeCommand("chemag.showGraph");

    const panel = showGraph.lastPanel;
    assert.ok(panel, "lastPanel should be set after executing chemag.showGraph");

    const html = panel.webview.html;

    // Mermaid container — the inline runner targets `pre.mermaid`.
    assert.ok(
      html.includes('<pre class="mermaid">'),
      'webview HTML should contain <pre class="mermaid">',
    );

    // Fixture sample-workspace ships compounds `alpha` and `beta`. Both names
    // should appear inside the `<pre class="mermaid">…</pre>` block (the
    // graph-CLI output uses them as node labels).
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
