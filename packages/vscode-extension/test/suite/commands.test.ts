// ---------------------------------------------------------------------------
// wp-026d: command registration test.
//
// Asserts that all 6 chemag command IDs are registered with VS Code after
// activation, AND that the four newly-added IDs are declared in both the
// extension manifest's `contributes.commands` and `activationEvents`.
//
// Scope: registration only. We do NOT mock `vscode.window.showInputBox` /
// `showQuickPick` to drive end-to-end CLI invocation — the Electron harness
// has no sinon/vi mock layer, and adding one is out of scope. End-to-end
// behaviour is covered by:
//   - The CLI's own unit tests for `add compound`, `add unit`, `install-hooks`.
//   - The MCP server's tests for `where_should_this_go`.
//   - The manual Acceptance Criteria smoke check listed in the stage spec.
// ---------------------------------------------------------------------------

import * as assert from "node:assert/strict";
import * as vscode from "vscode";

const EXTENSION_ID = "chemag.chemag-vscode";

const NEW_COMMAND_IDS = [
  "chemag.addCompound",
  "chemag.addUnit",
  "chemag.whereShouldThisGo",
  "chemag.installHooks",
] as const;

const ALL_COMMAND_IDS = ["chemag.checkWorkspace", "chemag.showGraph", ...NEW_COMMAND_IDS] as const;

const NEW_ACTIVATION_EVENTS = NEW_COMMAND_IDS.map((id) => `onCommand:${id}`);

suite("chemag extension — wp-026d commands registration", () => {
  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} should be discoverable`);
    if (!ext.isActive) {
      await ext.activate();
    }
  });

  test("all 6 chemag commands are registered after activation", async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const id of ALL_COMMAND_IDS) {
      assert.ok(commands.includes(id), `command ${id} should be registered after activation`);
    }
  });

  test("manifest declares all 4 new commands in contributes.commands", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "extension manifest should be discoverable");
    const contributed = ext?.packageJSON?.contributes?.commands as
      | Array<{ command?: string; title?: string; category?: string }>
      | undefined;
    assert.ok(Array.isArray(contributed), "contributes.commands should be an array");
    const declaredIds = new Set(contributed.map((c) => c.command).filter(Boolean));
    for (const id of NEW_COMMAND_IDS) {
      assert.ok(declaredIds.has(id), `contributes.commands should declare ${id}`);
    }
  });

  test("manifest declares onCommand activation events for all 4 new commands", () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, "extension manifest should be discoverable");
    const events = ext?.packageJSON?.activationEvents as string[] | undefined;
    assert.ok(Array.isArray(events), "activationEvents should be an array");
    for (const ev of NEW_ACTIVATION_EVENTS) {
      assert.ok(events.includes(ev), `activationEvents should include ${ev}`);
    }
  });
});
