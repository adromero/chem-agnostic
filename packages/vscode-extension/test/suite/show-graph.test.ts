// ---------------------------------------------------------------------------
// wp-026e: `chemag.showGraph` webview test.
//
// Asserts that executing the command opens a webview whose viewType is
// `chemag.graph` (the panel created by `makeShowGraphCommand`). Discovery
// goes through `vscode.window.tabGroups` because the bundled extension
// (`dist/extension.js`) and the source-compiled test code (`out/src/...`)
// are two distinct module instances at runtime — a `lastPanel` exported
// from the source module would never reflect what the bundled command
// assigned to ITS copy. The tabGroups API sees what the running extension
// actually opened.
//
// HTML-shape assertions (CSP, nonce, `<pre class="mermaid">`, alpha+beta
// substrings, no remote URLs) are covered by the unit-level test against
// `renderGraphHtml` directly — see graph-html.test.ts.
// ---------------------------------------------------------------------------

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "chemag.chemag-vscode";
const VIEW_TYPE = "chemag.graph";

suite("chemag.showGraph webview", () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} should be discoverable`);
    if (!ext.isActive) {
      await ext.activate();
    }
  });

  teardown(async () => {
    // Best-effort cleanup so successive tests don't pile up panels.
    for (const tab of allWebviewTabs()) {
      await vscode.window.tabGroups.close(tab);
    }
  });

  test("executes chemag.showGraph and opens a chemag.graph webview", async function () {
    this.timeout(30_000);

    await vscode.commands.executeCommand("chemag.showGraph");

    // Poll briefly — createWebviewPanel resolves synchronously but the tab
    // model can lag a tick in vscode-test.
    const tab = await waitForWebviewTab(VIEW_TYPE, 5_000);
    assert.ok(tab, `expected a webview tab with viewType "${VIEW_TYPE}"`);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function allWebviewTabs(): vscode.Tab[] {
  const tabs: vscode.Tab[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview) tabs.push(tab);
    }
  }
  return tabs;
}

async function waitForWebviewTab(viewType: string, timeoutMs: number): Promise<vscode.Tab | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const tab of allWebviewTabs()) {
      const input = tab.input as vscode.TabInputWebview;
      // VS Code prefixes contributed webview viewTypes with the producer
      // extension's id, e.g. `mainThreadWebview-chemag.graph`. Match either
      // shape to stay robust across vscode-test versions.
      if (input.viewType === viewType || input.viewType.endsWith(`-${viewType}`)) {
        return tab;
      }
    }
    await sleep(100);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
