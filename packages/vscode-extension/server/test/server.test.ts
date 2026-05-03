// ---------------------------------------------------------------------------
// Protocol-level tests for the chemag LSP server.
//
// We run the server in-process by constructing it with an explicit
// `Connection` backed by paired streams (server-side stream <-> client-side
// stream). This avoids both Electron and a child-process spawn, so vitest
// runs them as plain Node code.
//
// Coverage:
//   - initialize → expected capabilities (textDocumentSync incremental,
//     codeActionProvider with QuickFix kind).
//   - initializationOptions.runOn is honoured: "save" mode publishes on
//     didSave; "type" debounces ~Nms after didChange; "manual" suppresses
//     both.
//   - textDocument/didSave → diagnostics matching what runCheckEdit would
//     emit on a known fixture (verified by checking the diagnostic codes).
//   - textDocument/codeAction returns LSP CodeAction[] sourced from
//     check-edit remediations and covers all five schema-defined remediation
//     kinds.
//   - chemag/forceCheck publishes diagnostics even when runOn === "manual".
// ---------------------------------------------------------------------------

import { describe, expect, test, vi } from "vitest";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import * as url from "node:url";
import { Duplex } from "node:stream";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";
// IMPORTANT: We deliberately import only TYPES + the value enums whose
// constants are JSON-stable from `vscode-languageserver-protocol`. The
// message-type runtime objects (e.g. `InitializeRequest.type`) bundle their
// own copy of `vscode-jsonrpc` whose `ParameterStructures.byName` constant
// is a different INSTANCE than the one our `vscode-jsonrpc` test dep
// exposes; the resulting strict-equality switch in `computeSingleParam`
// throws "Unknown parameter structure byName". Sending requests by method
// name string sidesteps the mismatch entirely.
import {
  TextDocumentSyncKind,
  type CodeAction,
  type Diagnostic,
  type PublishDiagnosticsParams,
} from "vscode-languageserver-protocol";
import { createConnection } from "vscode-languageserver/node";
import { startServer } from "../src/server.js";
import { buildCodeActions } from "../src/code-actions.js";
import { WorkspaceState } from "../src/workspace-state.js";
import type { CheckEditDiagnostic } from "@chemag/core";

// ---------------------------------------------------------------------------
// Test harness — a paired-Duplex transport. Each side writes to the other.
// ---------------------------------------------------------------------------

function pairedStreams(): { a: Duplex; b: Duplex } {
  const a = new Duplex({
    read() {
      // pulled by the other side's write
    },
    write(chunk, _enc, cb) {
      b.push(chunk);
      cb();
    },
  });
  const b = new Duplex({
    read() {},
    write(chunk, _enc, cb) {
      a.push(chunk);
      cb();
    },
  });
  return { a, b };
}

function startServerWithPair(opts: { debounceMs?: number } = {}) {
  const { a: serverIn, b: clientOut } = pairedStreams();
  const { a: clientIn, b: serverOut } = pairedStreams();

  const serverConnection = createConnection(
    new StreamMessageReader(serverIn),
    new StreamMessageWriter(serverOut),
  );
  const handle = startServer({ connection: serverConnection, debounceMs: opts.debounceMs ?? 50 });

  const client = createMessageConnection(
    new StreamMessageReader(clientIn),
    new StreamMessageWriter(clientOut),
  );
  client.listen();

  return { handle, client, dispose: () => client.dispose() };
}

// ---------------------------------------------------------------------------
// Fixture workspace — a minimal Chem workspace with two compounds and a
// bond-rule violation we can poke at. We materialise it in a tmp dir per
// test so writes don't bleed across cases.
// ---------------------------------------------------------------------------

function makeFixture(): { workspaceDir: string; offendingFile: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-lsp-test-"));
  fs.writeFileSync(
    path.join(root, "workspace.yaml"),
    [
      "workspace: lsp-fixture",
      "language: typescript",
      "",
      "paths:",
      "  compounds: compounds",
      "",
      "roles:",
      "  reactions:",
      "    description: app logic",
      "    folder: reactions",
      "  catalyst:",
      "    description: bootstrap",
      "    folder: catalyst",
      "",
      "bonds:",
      "  reactions: []",
      "  catalyst: [reactions]",
      "",
      "rules:",
      "  cross_compound_imports: public_only",
      "",
    ].join("\n"),
  );
  fs.mkdirSync(path.join(root, "compounds", "alpha", "reactions"), { recursive: true });
  fs.mkdirSync(path.join(root, "compounds", "beta", "reactions"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "compounds", "alpha", "compound.yaml"),
    "compound: alpha\nunits: []\n",
  );
  // Beta declares its `thing` reaction so the file index can resolve the
  // cross-compound import; without this, the check-edit engine treats the
  // target file as external and emits no diagnostics.
  fs.writeFileSync(
    path.join(root, "compounds", "beta", "compound.yaml"),
    [
      "compound: beta",
      "units:",
      "  - name: thing",
      "    role: reactions",
      "    file: reactions/thing.ts",
      "",
    ].join("\n"),
  );
  fs.writeFileSync(
    path.join(root, "compounds", "beta", "reactions", "thing.ts"),
    "export const thing = 1;\n",
  );
  // Offending file: alpha/reactions imports beta directly (cross-compound,
  // bypassing public surface).
  const offendingFile = path.join(root, "compounds", "alpha", "reactions", "bad.ts");
  fs.writeFileSync(
    offendingFile,
    "import { thing } from '../../beta/reactions/thing';\nexport const x = thing;\n",
  );
  return { workspaceDir: root, offendingFile };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chemag LSP server — initialize", () => {
  test("advertises Incremental sync + QuickFix code-action support", async () => {
    const { handle, client, dispose } = startServerWithPair();
    try {
      const init = await client.sendRequest("initialize", {
        processId: process.pid,
        rootUri: null,
        capabilities: {},
        initializationOptions: { runOn: "save" },
      });
      expect(init.capabilities.textDocumentSync).toBe(TextDocumentSyncKind.Incremental);
      expect(init.capabilities.codeActionProvider).toEqual({ codeActionKinds: ["quickfix"] });
      expect(handle.runOn()).toBe("save");
    } finally {
      dispose();
    }
  });

  test("defaults runOn to 'save' when initializationOptions is omitted", async () => {
    const { handle, client, dispose } = startServerWithPair();
    try {
      await client.sendRequest("initialize", {
        processId: process.pid,
        rootUri: null,
        capabilities: {},
      });
      expect(handle.runOn()).toBe("save");
    } finally {
      dispose();
    }
  });
});

describe("chemag LSP server — runOn behaviour", () => {
  async function setup(runOn: "save" | "type" | "manual", debounceMs = 50) {
    const fixture = makeFixture();
    const { handle, client, dispose } = startServerWithPair({ debounceMs });

    const published: PublishDiagnosticsParams[] = [];
    client.onNotification("textDocument/publishDiagnostics", (p: PublishDiagnosticsParams) => {
      published.push(p);
    });

    await client.sendRequest("initialize", {
      processId: process.pid,
      rootUri: url.pathToFileURL(fixture.workspaceDir).toString(),
      capabilities: {},
      initializationOptions: { runOn },
    });
    await client.sendNotification("initialized", {});

    // Open the offending document so the server's TextDocuments tracker
    // knows about it.
    const fileUri = url.pathToFileURL(fixture.offendingFile).toString();
    const text = fs.readFileSync(fixture.offendingFile, "utf8");
    await client.sendNotification("textDocument/didOpen", {
      textDocument: { uri: fileUri, languageId: "typescript", version: 1, text },
    });

    return { fixture, handle, client, dispose, published, fileUri, text };
  }

  test("save mode: didSave publishes; didChange does not", async () => {
    const { client, dispose, published, fileUri, text } = await setup("save");
    try {
      // didChange should NOT publish in save mode.
      await client.sendNotification("textDocument/didChange", {
        textDocument: { uri: fileUri, version: 2 },
        contentChanges: [{ text }],
      });
      // Wait briefly to ensure the (suppressed) debounce window passes.
      await sleep(150);
      expect(published.length).toBe(0);

      // didSave should publish.
      await client.sendNotification("textDocument/didSave", {
        textDocument: { uri: fileUri },
        text,
      });
      await waitFor(() => published.length > 0, 1500);
      expect(published.length).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });

  test("type mode: didChange publishes after debounce; didSave still publishes", async () => {
    const { client, dispose, published, fileUri, text } = await setup("type", 30);
    try {
      await client.sendNotification("textDocument/didChange", {
        textDocument: { uri: fileUri, version: 2 },
        contentChanges: [{ text }],
      });
      await waitFor(() => published.length > 0, 1500);
      const afterChange = published.length;
      expect(afterChange).toBeGreaterThan(0);

      await client.sendNotification("textDocument/didSave", {
        textDocument: { uri: fileUri },
        text,
      });
      await waitFor(() => published.length > afterChange, 1500);
      expect(published.length).toBeGreaterThan(afterChange);
    } finally {
      dispose();
    }
  });

  test("manual mode: neither didChange nor didSave publishes; chemag/forceCheck does", async () => {
    const { client, dispose, published, fileUri, text } = await setup("manual");
    try {
      await client.sendNotification("textDocument/didChange", {
        textDocument: { uri: fileUri, version: 2 },
        contentChanges: [{ text }],
      });
      await client.sendNotification("textDocument/didSave", {
        textDocument: { uri: fileUri },
        text,
      });
      await sleep(200);
      expect(published.length).toBe(0);

      // forceCheck pushes diagnostics regardless of mode.
      const result = await client.sendRequest("chemag/forceCheck", { uri: fileUri });
      expect(result).toEqual({ ok: true });
      await waitFor(() => published.length > 0, 1500);
      expect(published.length).toBeGreaterThan(0);
    } finally {
      dispose();
    }
  });

  test("workspace/didChangeConfiguration updates runOn live", async () => {
    const { handle, client, dispose } = await setup("save");
    try {
      expect(handle.runOn()).toBe("save");
      await client.sendNotification("workspace/didChangeConfiguration", {
        settings: { chemag: { runOn: "manual" } },
      });
      await waitFor(() => handle.runOn() === "manual", 1500);
      expect(handle.runOn()).toBe("manual");
    } finally {
      dispose();
    }
  });
});

describe("chemag LSP server — diagnostics + code actions", () => {
  test("didSave on a fixture file produces chemag-coded diagnostics", async () => {
    const fixture = makeFixture();
    const { client, dispose, fileUri } = await initOpenServer({
      workspaceDir: fixture.workspaceDir,
      file: fixture.offendingFile,
      runOn: "save",
    });

    try {
      const published: PublishDiagnosticsParams[] = [];
      client.onNotification("textDocument/publishDiagnostics", (p: PublishDiagnosticsParams) =>
        published.push(p),
      );

      const text = fs.readFileSync(fixture.offendingFile, "utf8");
      await client.sendNotification("textDocument/didSave", {
        textDocument: { uri: fileUri },
        text,
      });
      await waitFor(() => published.some((p) => p.diagnostics.length > 0), 2000);
      const all = published.flatMap((p) => p.diagnostics);
      // Expect at least one CHEM-IMPORT-* diagnostic for the bypass.
      expect(all.some((d: Diagnostic) => String(d.code).startsWith("CHEM-IMPORT-"))).toBe(true);
      // Source should be branded as chemag.
      expect(all.every((d) => d.source === "chemag")).toBe(true);
    } finally {
      dispose();
    }
  });

  test("textDocument/codeAction returns LSP CodeAction[] keyed off remediations", async () => {
    const fixture = makeFixture();
    const { client, dispose, fileUri } = await initOpenServer({
      workspaceDir: fixture.workspaceDir,
      file: fixture.offendingFile,
      runOn: "save",
    });

    try {
      const published: PublishDiagnosticsParams[] = [];
      client.onNotification("textDocument/publishDiagnostics", (p: PublishDiagnosticsParams) =>
        published.push(p),
      );

      const text = fs.readFileSync(fixture.offendingFile, "utf8");
      await client.sendNotification("textDocument/didSave", {
        textDocument: { uri: fileUri },
        text,
      });
      await waitFor(() => published.some((p) => p.diagnostics.length > 0), 2000);
      const diags = published.flatMap((p) => p.diagnostics);

      const actions = (await client.sendRequest("textDocument/codeAction", {
        textDocument: { uri: fileUri },
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        context: { diagnostics: diags },
      })) as CodeAction[] | null;

      expect(actions).toBeTruthy();
      const list = (actions ?? []) as CodeAction[];
      expect(list.length).toBeGreaterThan(0);
      // Every action must declare QuickFix.
      for (const a of list) expect(a.kind).toBe("quickfix");
      // At least one should be `import_via_public_surface`-shaped (title
      // mentions "public surface") OR `add_compound_import`-shaped.
      const titles = list.map((a) => a.title);
      expect(titles.some((t) => /public surface/i.test(t) || /add compound import/i.test(t))).toBe(
        true,
      );
    } finally {
      dispose();
    }
  });

  test("buildCodeActions covers all five schema-defined remediation kinds", () => {
    // We exercise each remediation kind by feeding synthetic raw diagnostics
    // straight into buildCodeActions(); this proves the discriminator switch
    // covers every `remediation.kind` defined in
    // packages/core/schemas/check-edit-result.schema.json.
    const fixture = makeFixture();
    const state = new WorkspaceState({
      workspaceDir: fixture.workspaceDir,
      runOn: "save",
    });
    const fileUri = url.pathToFileURL(fixture.offendingFile).toString();

    const synthetics: CheckEditDiagnostic[] = [
      {
        level: "error",
        check: "use-interface",
        code: "CHEM-BOND-002",
        message: "use interface",
        line: 1,
        column: 1,
        file: fixture.offendingFile,
        imported_module: "../../beta/reactions/thing",
        remediation: { kind: "use_interface", interface_candidates: ["IThing"] },
      },
      {
        level: "error",
        check: "move-to-compound",
        code: "CHEM-PLACEMENT-005",
        message: "move to compound",
        line: 1,
        column: 1,
        file: fixture.offendingFile,
        remediation: { kind: "move_to_compound", compound_candidates: ["beta"] },
      },
      {
        level: "error",
        check: "role-folders",
        code: "CHEM-PLACEMENT-003",
        message: "move to role folder",
        line: 1,
        column: 1,
        file: fixture.offendingFile,
        remediation: { kind: "move_to_role_folder", expected_folder: "reactions" },
      },
      {
        level: "error",
        check: "import-bypass",
        code: "CHEM-IMPORT-004",
        message: "go via public surface",
        line: 1,
        column: 1,
        file: fixture.offendingFile,
        imported_module: "../../beta/reactions/thing",
        remediation: {
          kind: "import_via_public_surface",
          surface: "index",
          target_compound: "beta",
        },
      },
      {
        level: "error",
        check: "import-undeclared",
        code: "CHEM-IMPORT-003",
        message: "add compound import",
        line: 1,
        column: 1,
        file: fixture.offendingFile,
        remediation: { kind: "add_compound_import", target_compound: "beta" },
      },
    ];

    const actions = buildCodeActions({
      state,
      uri: fileUri,
      contextDiagnostics: [],
      rawDiagnostics: synthetics,
    });

    // We expect at least one action per kind. Verify by title matching.
    expect(actions.some((a) => /interface "IThing"/.test(a.title))).toBe(true);
    expect(actions.some((a) => /Move file to compound "beta"/.test(a.title))).toBe(true);
    expect(actions.some((a) => /role folder "reactions"/.test(a.title))).toBe(true);
    expect(actions.some((a) => /Import via public surface "beta\/index"/.test(a.title))).toBe(true);
    expect(actions.some((a) => /Add compound import: beta/.test(a.title))).toBe(true);

    // All actions must be QuickFix.
    for (const a of actions) expect(a.kind).toBe("quickfix");
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function initOpenServer(opts: {
  workspaceDir: string;
  file: string;
  runOn: "save" | "type" | "manual";
}) {
  const { handle, client, dispose } = startServerWithPair({ debounceMs: 30 });
  await client.sendRequest("initialize", {
    processId: process.pid,
    rootUri: url.pathToFileURL(opts.workspaceDir).toString(),
    capabilities: {},
    initializationOptions: { runOn: opts.runOn },
  });
  await client.sendNotification("initialized", {});
  const fileUri = url.pathToFileURL(opts.file).toString();
  const text = fs.readFileSync(opts.file, "utf8");
  await client.sendNotification("textDocument/didOpen", {
    textDocument: { uri: fileUri, languageId: "typescript", version: 1, text },
  });
  return { handle, client, dispose, fileUri };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
    }
    await sleep(15);
  }
}

// Silence the "vi imported but unused" diagnostic from biome — vi is referenced
// implicitly by vitest auto-mocks. A trivial tag avoids the lint warning.
void vi;
