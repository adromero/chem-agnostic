// ---------------------------------------------------------------------------
// wp-026b: end-to-end Quick Fix wiring test.
//
// Asserts that a CHEM-IMPORT-004 violation in the fixture workspace produces
// at least one `vscode.CodeActionKind.QuickFix` `CodeAction` (carrying a
// non-empty `WorkspaceEdit`) when surfaced through VS Code's
// `vscode.executeCodeActionProvider` command — i.e. the same path the
// editor's lightbulb uses.
//
// The 5-kind contract (one quick fix per remediation kind) is covered at the
// protocol level by `packages/lsp-server/test/server.test.ts` (the test
// `buildCodeActions covers all five schema-defined remediation kinds`).
// THIS test only proves the protocol-to-UI plumbing for ONE representative
// kind: `import_via_public_surface` (CHEM-IMPORT-004's remediation).
//
// runOn race trap (CI-pinned, post-arbiter):
//   Earlier the test switched `chemag.runOn` to "type" so didChange would
//   drive the check. In practice the round-trip
//   (workspace/didChangeConfiguration → server.setRunOn → didOpen →
//   debounced 800ms run) is racey on slow CI hosts and the 10s diagnostic
//   poll times out. Instead, we keep the runOn default and force a check
//   explicitly via `chemag.checkWorkspace`, which calls
//   `ChemagLspClient.forceCheck` — that runs `runAndPublish` synchronously
//   on the server regardless of runOn mode.
// ---------------------------------------------------------------------------

import * as assert from "node:assert/strict";
import * as path from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "chemag.chemag-vscode";

// Diagnostic poll budget AFTER `chemag.checkWorkspace` has been kicked off.
// forceCheck publishes synchronously from the server's perspective, but the
// notification has to round-trip back to the client; 15s gives generous
// headroom for slow CI hosts.
const DIAGNOSTIC_TIMEOUT_MS = 15_000;

suite("chemag extension — Quick Fix wiring (wp-026b)", () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} should be discoverable`);
    if (!ext.isActive) {
      await ext.activate();
    }
  });

  test("CHEM-IMPORT-004 surfaces an import_via_public_surface QuickFix with a WorkspaceEdit", async function () {
    // The default mocha timeout is 30s (set in suite/index.ts); this test
    // needs the diagnostic poll budget plus VS Code's command latency.
    this.timeout(45_000);

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, "fixture workspace folder should be open");

    const badPath = path.join(
      workspaceFolder.uri.fsPath,
      "compounds",
      "alpha",
      "reactions",
      "bad.ts",
    );
    const uri = vscode.Uri.file(badPath);

    // Open + show the offending document. Showing it (not just opening) is
    // belt-and-braces for clients that gate didOpen on visibility.
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });

    // Force a check. `chemag.checkWorkspace` spawns the chemag CLI AND calls
    // `lsp.forceCheck(activeUri)` on the LSP client; the latter triggers
    // `runAndPublish` on the server synchronously, bypassing the runOn mode
    // entirely. Avoids the runOn=type config-change race that fails on slow
    // CI hosts.
    await vscode.commands.executeCommand("chemag.checkWorkspace");

    // Poll for at least one chemag-coded diagnostic. The LSP server publishes
    // CHEM-IMPORT-003 (undeclared compound import) AND CHEM-IMPORT-004
    // (bypass of public surface) for this fixture; either presence proves
    // the engine ran. We assert specifically on CHEM-IMPORT-004 once the
    // first chemag diagnostic arrives.
    await waitForDiagnostics(uri, DIAGNOSTIC_TIMEOUT_MS);
    const diagnostics = vscode.languages.getDiagnostics(uri);
    const chemagDiags = diagnostics.filter((d) => d.source === "chemag");
    assert.ok(
      chemagDiags.length > 0,
      `expected at least one chemag-source diagnostic, got: ${JSON.stringify(diagnostics)}`,
    );
    const codes = chemagDiags.map((d) => String(d.code ?? ""));
    assert.ok(
      codes.includes("CHEM-IMPORT-004"),
      `expected CHEM-IMPORT-004 among chemag diagnostics, got: ${codes.join(", ")}`,
    );

    // Build a range covering the entire document — the executeCodeActionProvider
    // command requests actions for the supplied range, so we hand it the whole
    // file to capture every offered fix.
    const fullRange = new vscode.Range(
      new vscode.Position(0, 0),
      doc.lineAt(doc.lineCount - 1).range.end,
    );

    const actions =
      (await vscode.commands.executeCommand<vscode.CodeAction[]>(
        "vscode.executeCodeActionProvider",
        uri,
        fullRange,
      )) ?? [];

    // Filter to QuickFix actions sourced from the LSP server. Other providers
    // (e.g. the TS language service) may inject unrelated actions; we only
    // need to assert chemag's lightbulb plumbing works.
    const quickFixes = actions.filter(
      (a) => a.kind?.value === vscode.CodeActionKind.QuickFix.value,
    );
    assert.ok(
      quickFixes.length > 0,
      `expected at least one QuickFix action, got: ${actions.map((a) => `${a.title} [${a.kind?.value ?? "?"}]`).join("; ")}`,
    );

    // The representative action we assert on: the import_via_public_surface
    // remediation. Title produced by code-actions.ts is
    // `Import via public surface "beta/index"`.
    const surfaceFix = quickFixes.find((a) => /public surface/i.test(a.title));
    assert.ok(
      surfaceFix,
      `expected an "Import via public surface" QuickFix, got titles: ${quickFixes.map((a) => a.title).join("; ")}`,
    );

    // Structural assertion: the fix carries a non-empty WorkspaceEdit that
    // would rewrite the offending specifier — this proves the round-trip
    // through vscode-languageclient preserved the server's edit payload.
    assert.ok(surfaceFix.edit, "import_via_public_surface action must carry an edit");
    const entries = surfaceFix.edit.entries();
    assert.ok(
      entries.length > 0,
      `WorkspaceEdit should contain at least one URI's edits; got: ${JSON.stringify(entries)}`,
    );
    const [, edits] = entries[0];
    assert.ok(edits.length > 0, "WorkspaceEdit should contain at least one TextEdit");
    // The replacement value is the public-surface module path: `beta/index`.
    assert.ok(
      edits.some((e) => /beta\/index/.test(e.newText)),
      `expected a TextEdit replacing the specifier with "beta/index", got: ${edits
        .map((e) => JSON.stringify(e.newText))
        .join(", ")}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Poll `vscode.languages.getDiagnostics(uri)` every ~50ms until at least one
 * chemag-source diagnostic appears. Throws on timeout. Modelled after the
 * `waitFor(pred, timeoutMs)` helper at lines 510-518 of
 * packages/lsp-server/test/server.test.ts.
 */
async function waitForDiagnostics(uri: vscode.Uri, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const diags = vscode.languages.getDiagnostics(uri);
    if (diags.some((d) => d.source === "chemag")) return;
    await sleep(50);
  }
  throw new Error(
    `waitForDiagnostics: no chemag-source diagnostic for ${uri.toString()} within ${timeoutMs}ms`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
