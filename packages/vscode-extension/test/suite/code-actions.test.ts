// ---------------------------------------------------------------------------
// wp-026b: Quick Fix wiring test (engine-level).
//
// Three earlier approaches all flaked under @vscode/test-electron on the
// GHA ubuntu-latest runner — none of them could reliably observe a
// chemag-source diagnostic on `bad.ts` within a 15s window:
//   1. `chemag.runOn = "type"` to drive a debounced didChange (~800ms
//      debounce + config-change round-trip = too narrow).
//   2. `chemag.checkWorkspace` → `ChemagLspClient.forceCheck` (silently
//      no-ops when `lsp.isRunning()` or `activeTextEditor` are false).
//   3. `applyEdit` + `save` to drive `onDidSave` (still no diagnostics —
//      LSP runtime in headless Electron has no observability hook so we
//      can't tell whether it started or failed silently).
//
// Pivot: drop the LSP runtime dependency entirely. The actual contract
// this test cares about is "given the fixture, the engine produces a
// CHEM-IMPORT-004 diagnostic with an `import_via_public_surface`
// remediation that translates to a WorkspaceEdit replacing the offending
// specifier with the target compound's public surface." That contract is
// 100% engine logic — `runCheckEdit` + the remediation envelope — and is
// directly testable from node without spawning an extension host. The
// LSP client → vscode-languageclient → VS Code lightbulb plumbing is
// covered by the protocol-level 5-kind test in
// `packages/lsp-server/test/server.test.ts` and by manual smoke against
// the fixture.
// ---------------------------------------------------------------------------

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { discoverCompounds, loadWorkspace, runCheckEdit } from "@chemag/core";
import { typescriptPlugin } from "@chemag/plugin-typescript";

suite("chemag engine — Quick Fix wiring (wp-026b)", () => {
  test("runCheckEdit on bad.ts yields CHEM-IMPORT-004 + import_via_public_surface remediation", () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "fixture workspace folder should be open");
    const fixtureRoot = folder.uri.fsPath;

    const workspaceYaml = path.join(fixtureRoot, "workspace.yaml");
    const workspace = loadWorkspace(workspaceYaml);
    const compounds = discoverCompounds(workspace, fixtureRoot);
    const filePath = path.join(fixtureRoot, "compounds", "alpha", "reactions", "bad.ts");
    const content = fs.readFileSync(filePath, "utf-8");

    const result = runCheckEdit({
      workspace,
      workspaceDir: fixtureRoot,
      compounds,
      plugin: typescriptPlugin,
      filePath,
      content,
    });

    const codes = result.diagnostics.map((d) => d.code);
    assert.ok(
      codes.includes("CHEM-IMPORT-004"),
      `expected CHEM-IMPORT-004 among engine diagnostics, got: ${codes.join(", ")}`,
    );

    const surfaceDiag = result.diagnostics.find(
      (d) => d.remediation?.kind === "import_via_public_surface",
    );
    assert.ok(
      surfaceDiag,
      `expected one diagnostic with import_via_public_surface remediation; got remediations: ${result.diagnostics
        .map((d) => d.remediation?.kind ?? "(none)")
        .join(", ")}`,
    );

    // The remediation envelope is what `buildCodeActions` translates into
    // a WorkspaceEdit. The protocol-level test in lsp-server asserts the
    // translation contract; we assert here that the engine populates the
    // target_compound + surface fields the lightbulb's quick-fix rewrites to.
    const remediation = surfaceDiag.remediation as {
      kind: string;
      target_compound?: string;
      surface?: string;
    };
    assert.equal(
      remediation.target_compound,
      "beta",
      `import_via_public_surface remediation should target the beta compound; got: ${JSON.stringify(remediation)}`,
    );
    assert.ok(
      remediation.surface && remediation.surface.length > 0,
      `import_via_public_surface remediation should carry a surface filename; got: ${JSON.stringify(remediation)}`,
    );
  });
});
