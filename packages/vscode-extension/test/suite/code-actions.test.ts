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
// CI-robust trigger:
//   Two earlier approaches turned out to be racey under @vscode/test-electron
//   on the GHA ubuntu-latest runner:
//     1. Setting `chemag.runOn = "type"` to drive a debounced didChange:
//        the workspace/didChangeConfiguration → server.setRunOn → didOpen →
//        800ms debounce chain has too narrow a margin.
//     2. Calling `chemag.checkWorkspace` to invoke `ChemagLspClient.forceCheck`:
//        check-workspace.ts only forceChecks when both `lsp?.isRunning()` AND
//        `activeTextEditor` are truthy; either can be false during the brief
//        window between activation and the first test running.
//   The most reliable trigger is also the simplest: keep runOn at its default
//   ("save"), modify the document so it becomes dirty, then save it. The
//   server's documents.onDidSave handler fires unconditionally for save mode
//   and runs runDiagnostics + publishes synchronously. Restore the file in a
//   teardown so subsequent test runs see the original bytes.
// ---------------------------------------------------------------------------

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

const EXTENSION_ID = "chemag.chemag-vscode";

// Diagnostic poll budget after the dirty-then-save trigger fires. The LSP
// server's onDidSave runs runDiagnostics synchronously on the server side,
// but the publishDiagnostics notification has to round-trip back to the
// client; 15s gives generous headroom for slow CI hosts.
const DIAGNOSTIC_TIMEOUT_MS = 15_000;

suite("chemag extension — Quick Fix wiring (wp-026b)", () => {
  let originalBadBytes: Buffer | null = null;
  let badPath = "";

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} should be discoverable`);
    if (!ext.isActive) {
      await ext.activate();
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, "fixture workspace folder should be open");
    badPath = path.join(workspaceFolder.uri.fsPath, "compounds", "alpha", "reactions", "bad.ts");
    // Capture original bytes so we can restore in suiteTeardown — the test
    // mutates the file (via WorkspaceEdit + save) to drive onDidSave.
    originalBadBytes = fs.readFileSync(badPath);
  });

  suiteTeardown(() => {
    if (originalBadBytes && badPath) {
      fs.writeFileSync(badPath, originalBadBytes);
    }
  });

  test("CHEM-IMPORT-004 surfaces an import_via_public_surface QuickFix with a WorkspaceEdit", async function () {
    // The default mocha timeout is 30s (set in suite/index.ts); this test
    // needs the diagnostic poll budget plus VS Code's command latency.
    this.timeout(45_000);

    const uri = vscode.Uri.file(badPath);

    // Open + show the offending document. Showing it (not just opening) is
    // belt-and-braces for clients that gate didOpen on visibility.
    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });

    // Trigger the LSP's onDidSave path (runOn=save, the default). Step 1:
    // make the document dirty by appending a trailing newline via WorkspaceEdit.
    // VS Code's TextDocument.save() is a documented no-op on a clean document,
    // so we have to mutate first. Step 2: save — this fires didSave, the
    // server runs runDiagnostics, and publishDiagnostics rolls the violations
    // back to the client.
    const endOfFile = editor.document.lineAt(editor.document.lineCount - 1).range.end;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, endOfFile, "\n");
    const applied = await vscode.workspace.applyEdit(edit);
    assert.ok(applied, "WorkspaceEdit (trailing newline) should apply cleanly");
    const saved = await editor.document.save();
    assert.ok(saved, "save() should succeed after the dirty WorkspaceEdit");

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
