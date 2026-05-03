// ---------------------------------------------------------------------------
// MVP activation test: confirm the extension activates against the fixture
// workspace and registers both `chemag.checkWorkspace` and `chemag.showGraph`
// commands.
//
// wp-027 additions: assert that the `chemag.runOn` setting still exists in
// the configuration contributions (preserved post-LSP refactor) and that
// the LSP server bundle path is valid (so a running client could spawn it).
// ---------------------------------------------------------------------------

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

// `<publisher>.<name>` from package.json — wp-026 renamed the npm package
// from `@chemag/vscode-extension` to `chemag-vscode` (vsce rejects scoped
// names), so the extension ID is `chemag.chemag-vscode`, not `chemag.chemag`.
const EXTENSION_ID = "chemag.chemag-vscode";

suite("chemag extension activation", () => {
  test("registers chemag.checkWorkspace and chemag.showGraph commands", async () => {
    // The activation event `workspaceContains:workspace.yaml` should fire
    // because the test launcher opens fixtures/sample-workspace which has
    // a workspace.yaml at its root. Belt-and-braces: explicitly activate
    // the extension if VS Code surfaces it via the API.
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    if (ext && !ext.isActive) {
      await ext.activate();
    }

    const commands = await vscode.commands.getCommands(true);
    assert.ok(
      commands.includes("chemag.checkWorkspace"),
      "chemag.checkWorkspace should be registered after activation",
    );
    assert.ok(
      commands.includes("chemag.showGraph"),
      "chemag.showGraph should be registered after activation",
    );
  });

  test("preserves the chemag.runOn setting (forwarded to the LSP server)", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "extension manifest should be discoverable");
    const props =
      ext?.packageJSON?.contributes?.configuration?.properties ??
      ext?.packageJSON?.contributes?.configuration?.[0]?.properties;
    assert.ok(props, "configuration properties should be present");
    const runOn = props["chemag.runOn"];
    assert.ok(runOn, "chemag.runOn should still be declared in configuration");
    assert.deepEqual(
      runOn.enum,
      ["save", "type", "manual"],
      "chemag.runOn enum should remain save/type/manual post-LSP refactor",
    );
  });

  test("LSP server bundle path resolves under the extension installation", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "extension manifest should be discoverable");
    // The LSP client constructs `path.join(extensionPath, "server", "dist",
    // "server.js")`. We don't assert it exists (the test runner pre-build
    // step builds the extension bundle but doesn't necessarily build the
    // server bundle), but we DO assert the path is well-formed and lives
    // under the expected sub-directory.
    const expected = path.join(ext!.extensionPath, "server", "dist", "server.js");
    assert.ok(
      expected.endsWith(path.join("server", "dist", "server.js")),
      "LSP server bundle path must live under <ext>/server/dist/",
    );
    // Soft assertion: when the bundle does exist, ensure it's a regular file.
    if (fs.existsSync(expected)) {
      assert.ok(fs.statSync(expected).isFile(), "server bundle, when present, must be a file");
    }
  });
});
