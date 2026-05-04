// ---------------------------------------------------------------------------
// wp-026c: Architecture sidebar tree view test.
//
// Asserts:
//   1. The chemag activity-bar view container is opened without throwing.
//   2. The tree provider populates from the fixture's workspace.yaml — both
//      compounds appear (alpha + beta), alpha shows the explanatory empty
//      placeholder, and beta has the expected role -> unit hierarchy.
//   3. A mutation to compounds/beta/compound.yaml triggers a refresh — the
//      newly-added unit appears in the tree within ~1 s.
//   4. Violation badges appear: we publish a synthetic chemag-source
//      diagnostic for beta's unit file via a temporary DiagnosticCollection
//      and assert the unit's TreeItem.description reflects the count.
//
// Fixture restoration discipline: every mutation to compounds/beta/compound.yaml
// is bracketed with try/finally + restored in suiteTeardown using the bytes
// captured in suiteSetup. A final byte-equality check at the end of
// suiteTeardown surfaces any leftover mutation immediately.
// ---------------------------------------------------------------------------

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

import { ChemagTreeView } from "../../src/tree-view";
import type { TreeNode } from "../../src/tree-view";

const EXTENSION_ID = "chemag.chemag-vscode";
const REFRESH_TIMEOUT_MS = 2_000;

suite("chemag extension — Architecture tree view (wp-026c)", () => {
  let workspaceDir: string;
  let betaManifestPath: string;
  let originalBetaBytes: Buffer;

  suiteSetup(async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `extension ${EXTENSION_ID} should be discoverable`);
    if (!ext.isActive) {
      await ext.activate();
    }
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(folder, "fixture workspace folder should be open");
    workspaceDir = folder.uri.fsPath;
    betaManifestPath = path.join(workspaceDir, "compounds", "beta", "compound.yaml");
    originalBetaBytes = fs.readFileSync(betaManifestPath);
  });

  suiteTeardown(() => {
    // Defensive restore + leftover-mutation check.
    fs.writeFileSync(betaManifestPath, originalBetaBytes);
    const after = fs.readFileSync(betaManifestPath);
    assert.equal(
      after.equals(originalBetaBytes),
      true,
      "beta/compound.yaml must match its original bytes after the suite finishes",
    );
  });

  teardown(() => {
    // Per-test defensive restore — guards against an assertion failure inside
    // a try/finally bypassing the inner restore. Cheap.
    fs.writeFileSync(betaManifestPath, originalBetaBytes);
  });

  test("activity-bar view container opens without throwing", async () => {
    // Resolves to undefined on success; throws if the container id doesn't
    // exist (e.g. the `viewsContainers` contribution is missing).
    await vscode.commands.executeCommand("workbench.view.extension.chemag");
  });

  test("tree populates: alpha (empty placeholder) + beta (reactions/thing)", () => {
    const view = new ChemagTreeView({ workspaceDir });
    try {
      const provider = providerOf(view);

      const roots = provider.getChildren() as TreeNode[];
      const labels = roots.map((n) => (n.kind === "compound" ? n.name : "?"));
      assert.deepEqual(labels.sort(), ["alpha", "beta"], "top level should be alpha + beta only");

      const alpha = roots.find((n) => n.kind === "compound" && n.name === "alpha");
      assert.ok(alpha && alpha.kind === "compound");
      const alphaChildren = provider.getChildren(alpha) as TreeNode[];
      assert.equal(alphaChildren.length, 1, "alpha (units: []) should yield one placeholder child");
      assert.equal(alphaChildren[0]?.kind, "empty");

      const beta = roots.find((n) => n.kind === "compound" && n.name === "beta");
      assert.ok(beta && beta.kind === "compound");
      const betaChildren = provider.getChildren(beta) as TreeNode[];
      assert.equal(betaChildren.length, 1, "beta should have one role folder");
      const role = betaChildren[0];
      assert.ok(role && role.kind === "role");
      assert.equal(role.role, "reactions");

      const unitNodes = provider.getChildren(role) as TreeNode[];
      assert.equal(unitNodes.length, 1);
      const unit = unitNodes[0];
      assert.ok(unit && unit.kind === "unit");
      assert.equal(unit.unit.name, "thing");
    } finally {
      view.dispose();
    }
  });

  test("file-change watcher refreshes the tree when compound.yaml mutates", async function () {
    this.timeout(15_000);

    const view = new ChemagTreeView({ workspaceDir });
    try {
      const provider = providerOf(view);

      // Sanity: pre-mutation beta has exactly one unit `thing`.
      const initialBeta = compoundChildrenByName(provider, "beta");
      assert.equal(initialBeta.unitCount, 1);

      // Mutate: append a second unit. We add a new unit instead of mere
      // whitespace so the assertion (unitCount === 2) is observable.
      const mutated = `${originalBetaBytes.toString("utf-8").replace(/\s*$/, "")}\n  - name: extra\n    role: reactions\n    file: reactions/extra.ts\n`;
      fs.writeFileSync(betaManifestPath, mutated);

      try {
        await waitFor(
          () => compoundChildrenByName(provider, "beta").unitCount === 2,
          REFRESH_TIMEOUT_MS,
        );
        const afterBeta = compoundChildrenByName(provider, "beta");
        assert.equal(
          afterBeta.unitCount,
          2,
          "watcher should pick up the appended unit within timeout",
        );
        assert.ok(
          afterBeta.unitNames.includes("extra"),
          `expected unit "extra" after refresh, got: ${afterBeta.unitNames.join(", ")}`,
        );
      } finally {
        // Always restore — even if the wait timed out — so the next test
        // and suiteTeardown both see the original bytes.
        fs.writeFileSync(betaManifestPath, originalBetaBytes);
      }
    } finally {
      view.dispose();
    }
  });

  test("violation badge appears on a unit with a chemag-source diagnostic", async () => {
    const view = new ChemagTreeView({ workspaceDir });
    const collection = vscode.languages.createDiagnosticCollection("chemag-tree-view-test");
    try {
      const provider = providerOf(view);
      const beta = (provider.getChildren() as TreeNode[]).find(
        (n) => n.kind === "compound" && n.name === "beta",
      );
      assert.ok(beta && beta.kind === "compound");
      const role = (provider.getChildren(beta) as TreeNode[])[0];
      assert.ok(role && role.kind === "role");
      const unit = (provider.getChildren(role) as TreeNode[])[0];
      assert.ok(unit && unit.kind === "unit");

      const fileUri = vscode.Uri.file(path.resolve(beta.dir, unit.unit.file));

      // Capture baseline counts: prior tests / the LSP server may already
      // have published chemag diagnostics for thing.ts. We assert deltas, not
      // absolutes, so this test stays order-independent.
      const baselineUnit = countChemag(provider.getTreeItem(unit).description);
      const baselineCompound = countChemag(provider.getTreeItem(beta).description);

      const synthetic = new vscode.Diagnostic(
        new vscode.Range(0, 0, 0, 1),
        "synthetic chemag violation (tree-view test)",
        vscode.DiagnosticSeverity.Error,
      );
      synthetic.source = "chemag";
      synthetic.code = "CHEM-TEST-001";

      const baselineCountForUri = vscode.languages
        .getDiagnostics(fileUri)
        .filter((d) => d.source === "chemag").length;
      collection.set(fileUri, [synthetic]);

      // VS Code coalesces diagnostic publishes onto a microtask; wait for our
      // synthetic diagnostic to be readable before asserting.
      await waitFor(
        () =>
          vscode.languages.getDiagnostics(fileUri).filter((d) => d.source === "chemag").length ===
          baselineCountForUri + 1,
        1_000,
      );

      // The provider listens to onDidChangeDiagnostics and re-renders
      // synchronously after we re-call getTreeItem; fetch the fresh item.
      const itemDescription = provider.getTreeItem(unit).description;
      assert.equal(
        countChemag(itemDescription),
        baselineUnit + 1,
        `unit TreeItem.description should reflect baseline+1; baseline=${baselineUnit} got=${String(itemDescription)}`,
      );

      // Compound badge aggregates: beta should also reflect the new diagnostic.
      const compoundDescription = provider.getTreeItem(beta).description;
      assert.equal(
        countChemag(compoundDescription),
        baselineCompound + 1,
        `compound TreeItem.description should aggregate baseline+1; baseline=${baselineCompound} got=${String(compoundDescription)}`,
      );

      // Clearing wipes the synthetic; description should drop back to baseline.
      collection.delete(fileUri);
      await waitFor(
        () =>
          vscode.languages.getDiagnostics(fileUri).filter((d) => d.source === "chemag").length ===
          baselineCountForUri,
        1_000,
      );
      const itemAfterDescription = provider.getTreeItem(unit).description;
      assert.equal(
        countChemag(itemAfterDescription),
        baselineUnit,
        "unit description should drop back to baseline after clearing the synthetic",
      );
    } finally {
      collection.dispose();
      view.dispose();
    }
  });
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface ProviderLike {
  // The implementation is synchronous; tighten the test surface so the assertions
  // can read TreeItem / TreeNode[] fields without juggling Thenable.
  getChildren(node?: TreeNode): TreeNode[];
  getTreeItem(node: TreeNode): vscode.TreeItem;
}

/**
 * Reach into ChemagTreeView for its private provider. The view exposes a
 * `refresh()` method but the test asserts on `getChildren()` shape directly,
 * which mirrors what VS Code does when expanding nodes. Using `unknown`
 * keeps the cast explicit instead of going through `any`.
 */
function providerOf(view: ChemagTreeView): ProviderLike {
  // The provider is a private field on the view; cast to a record-shape and
  // pull it out. Synchronous access — no Promise wrapping needed because the
  // provider's getChildren is synchronous.
  const internals = view as unknown as { provider: ProviderLike };
  return internals.provider;
}

function compoundChildrenByName(
  provider: ProviderLike,
  name: string,
): { unitCount: number; unitNames: string[] } {
  const roots = provider.getChildren() as TreeNode[];
  const compound = roots.find((n) => n.kind === "compound" && n.name === name);
  if (!compound || compound.kind !== "compound") return { unitCount: 0, unitNames: [] };
  const roleNodes = provider.getChildren(compound) as TreeNode[];
  let total = 0;
  const names: string[] = [];
  for (const role of roleNodes) {
    if (role.kind !== "role") continue;
    const units = provider.getChildren(role) as TreeNode[];
    for (const u of units) {
      if (u.kind === "unit") {
        total++;
        names.push(u.unit.name);
      }
    }
  }
  return { unitCount: total, unitNames: names };
}

/** Parse a `TreeItem.description` (string | true | undefined) as an integer count. */
function countChemag(description: string | boolean | undefined): number {
  if (typeof description !== "string") return 0;
  const n = Number.parseInt(description, 10);
  return Number.isNaN(n) ? 0 : n;
}

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`waitFor: predicate did not become true within ${timeoutMs}ms`);
}
