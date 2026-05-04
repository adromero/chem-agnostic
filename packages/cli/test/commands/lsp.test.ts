// ---------------------------------------------------------------------------
// `chemag lsp` smoke tests.
//
// Mirrors the structure of `mcp.test.ts`:
//
//   1. Pure unit tests against `cmdLsp` / runCli with mocked process.exit:
//      - `--help` prints usage to stdout and exits with code 0.
//      - `chemag --help` lists `lsp` under the Integrations group.
//      - `chemag lsp` invokes runServer (verified by mocking the dynamic
//        import of `@chemag/lsp-server`).
//
//   2. Subprocess handshake (skipped when the bin isn't built yet): spawn
//      `node bin/chem-ag lsp`, send a synthetic LSP `initialize` request
//      over stdio, assert the response advertises the same capabilities the
//      WP-027 baseline produces (textDocumentSync = Incremental,
//      codeActionProvider = QuickFix).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCli } from "../../src/cli.js";
import { cmdLsp, parseLspArgs } from "../../src/commands/lsp.js";
import { __resetForTesting } from "@chemag/core/vocabulary";
import { stripAnsi } from "../../src/ui/colors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CLI_BIN = path.resolve(REPO_ROOT, "packages/cli/bin/chem-ag");

let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;

beforeEach(() => {
  __resetForTesting();
  stdout = [];
  stderr = [];
  exitCode = undefined;

  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode = code;
    throw new Error("__cli_exit__");
  }) as never);
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    stdout.push(a.join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => {
    stderr.push(a.join(" "));
  });
});

afterEach(() => {
  __resetForTesting();
  vi.restoreAllMocks();
});

function runSafe(argv: string[]): void {
  try {
    runCli(argv);
  } catch (e: unknown) {
    if ((e as Error).message !== "__cli_exit__") throw e;
  }
}

// ---------------------------------------------------------------------------
// parseLspArgs — pure function unit tests
// ---------------------------------------------------------------------------

describe("parseLspArgs", () => {
  it("returns help=false for an empty argv", () => {
    expect(parseLspArgs([])).toEqual({ help: false });
  });
  it("returns help=true on --help", () => {
    expect(parseLspArgs(["--help"]).help).toBe(true);
  });
  it("returns help=true on -h", () => {
    expect(parseLspArgs(["-h"]).help).toBe(true);
  });
  it("ignores unknown flags (no error)", () => {
    expect(parseLspArgs(["--unknown", "foo"]).help).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cmdLsp — help path
// ---------------------------------------------------------------------------

describe("chemag lsp — help", () => {
  it("--help prints usage and returns 0", () => {
    const code = cmdLsp(["--help"]);
    expect(code).toBe(0);
    const text = stripAnsi(stdout.join("\n")).toLowerCase();
    expect(text).toContain("lsp");
    expect(text).toContain("usage");
    // Should NOT crash trying to dynamic-import the server.
    expect(stderr.join("\n")).toBe("");
  });

  it("runCli ['lsp', '--help'] dispatches to cmdLsp and prints usage", () => {
    runSafe(["lsp", "--help"]);
    // cmdLsp returns 0 for --help; the dispatcher only calls process.exit
    // when the code is non-zero, so exitCode stays undefined here.
    expect(exitCode).toBeUndefined();
    const text = stripAnsi(stdout.join("\n")).toLowerCase();
    expect(text).toContain("lsp");
    expect(text).toContain("language server protocol");
  });
});

// ---------------------------------------------------------------------------
// chemag --help lists `lsp` under Integrations
// ---------------------------------------------------------------------------

describe("chemag --help", () => {
  it("lists `lsp` under the INTEGRATIONS section", () => {
    runSafe(["--help"]);
    expect(exitCode).toBe(0);
    const text = stripAnsi(stdout.join("\n"));
    expect(text).toContain("INTEGRATIONS:");
    // The lsp row must appear (we don't assert exact framing — citty layout
    // may shift across versions — but we DO assert lsp appears in the help
    // text and that it appears AFTER the INTEGRATIONS heading and BEFORE
    // the next group heading).
    const integrationsIdx = text.indexOf("INTEGRATIONS:");
    const utilitiesIdx = text.indexOf("UTILITIES:");
    expect(integrationsIdx).toBeGreaterThan(-1);
    const integrationsBlock =
      utilitiesIdx > integrationsIdx
        ? text.slice(integrationsIdx, utilitiesIdx)
        : text.slice(integrationsIdx);
    expect(integrationsBlock).toMatch(/\blsp\b/);
  });
});

// ---------------------------------------------------------------------------
// cmdLsp — invokes runServer
//
// We use vi.hoisted + vi.mock to intercept the dynamic import of
// `@chemag/lsp-server` so we can assert that `runServer` was invoked exactly
// once without actually starting a real stdio LSP loop (which would attach
// to stdin and never terminate inside vitest).
// ---------------------------------------------------------------------------

const { runServerMock } = vi.hoisted(() => ({ runServerMock: vi.fn() }));

vi.mock("@chemag/lsp-server", () => ({
  runServer: runServerMock,
  startServer: runServerMock,
}));

describe("chemag lsp — boots the server", () => {
  beforeEach(() => {
    runServerMock.mockReset();
  });

  it("cmdLsp() with no args dynamic-imports @chemag/lsp-server and calls runServer", async () => {
    const code = cmdLsp([]);
    expect(code).toBe(0);
    // The dynamic import happens inside an async IIFE; await a microtask
    // flush so the promise chain resolves before we assert the mock.
    await new Promise<void>((r) => setImmediate(r));
    expect(runServerMock).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Subprocess handshake — initialize JSON-RPC round-trip over LSP framing
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: {
    capabilities?: {
      textDocumentSync?: number | object;
      codeActionProvider?: { codeActionKinds?: string[] } | boolean;
    };
  };
  error?: { code: number; message: string };
}

/**
 * LSP-framed JSON-RPC: each message is preceded by
 *   `Content-Length: <bytes>\r\n\r\n`
 * The server uses this framing on stdin/stdout.
 */
function frame(payload: object): Buffer {
  const body = Buffer.from(JSON.stringify(payload), "utf-8");
  const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
  return Buffer.concat([header, body]);
}

/** Parse one or more LSP-framed JSON-RPC messages from a streaming buffer. */
function parseFramedMessages(buffered: Buffer): {
  messages: JsonRpcResponse[];
  remainder: Buffer;
} {
  const out: JsonRpcResponse[] = [];
  let buf = buffered;
  while (true) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const header = buf.slice(0, headerEnd).toString("ascii");
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) {
      // Malformed header — drop everything up to and including the separator.
      buf = buf.slice(headerEnd + 4);
      continue;
    }
    const len = Number.parseInt(m[1], 10);
    const bodyStart = headerEnd + 4;
    if (buf.length < bodyStart + len) break;
    const body = buf.slice(bodyStart, bodyStart + len).toString("utf-8");
    try {
      out.push(JSON.parse(body) as JsonRpcResponse);
    } catch {
      // Ignore unparseable bodies; never block the loop.
    }
    buf = buf.slice(bodyStart + len);
  }
  return { messages: out, remainder: buf };
}

async function sendInitialize(
  child: ChildProcessWithoutNullStreams,
  requestId: number,
): Promise<JsonRpcResponse> {
  const initRequest = {
    jsonrpc: "2.0" as const,
    id: requestId,
    method: "initialize",
    params: {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
      initializationOptions: { runOn: "save" },
    },
  };

  return new Promise<JsonRpcResponse>((resolve, reject) => {
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      buffered = Buffer.concat([buffered, chunk]);
      const { messages, remainder } = parseFramedMessages(buffered);
      buffered = remainder;
      for (const msg of messages) {
        if (msg.id === requestId) {
          child.stdout.removeListener("data", onData);
          resolve(msg);
          return;
        }
      }
    };
    child.stdout.on("data", onData);

    const timer = setTimeout(() => {
      child.stdout.removeListener("data", onData);
      reject(new Error("Timed out waiting for LSP initialize response"));
    }, 10_000);

    child.once("exit", () => {
      clearTimeout(timer);
    });

    child.stdin.write(frame(initRequest));
  });
}

describe("chemag lsp — subprocess handshake", () => {
  // The bundled CLI bin must be present (Turbo `pnpm build` runs first) AND
  // the dist dir must exist for the dynamic import to resolve. On a fresh
  // clone before `pnpm build`, skip with a single explanatory note.
  const binAvailable =
    fs.existsSync(CLI_BIN) &&
    fs.existsSync(path.resolve(REPO_ROOT, "packages/cli/dist/cli.js")) &&
    fs.existsSync(path.resolve(REPO_ROOT, "packages/lsp-server/dist/server.js"));
  const skipReason = binAvailable ? null : "chem-ag bin or @chemag/lsp-server dist not built yet";

  it.skipIf(!binAvailable)(
    "responds to initialize with the expected LSP capabilities",
    async () => {
      const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-lsp-handshake-"));

      const child = spawn("node", [CLI_BIN, "lsp"], {
        cwd: wsDir,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, CHEMAG_NO_TELEMETRY_PROMPT: "1" },
      }) as ChildProcessWithoutNullStreams;

      try {
        const response = await sendInitialize(child, 1);
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
        const caps = response.result?.capabilities;
        expect(caps).toBeDefined();
        // textDocumentSync = Incremental (constant 2 per the LSP spec).
        expect(caps?.textDocumentSync).toBe(2);
        // codeActionProvider advertises QuickFix.
        const ca = caps?.codeActionProvider;
        expect(ca).toEqual({ codeActionKinds: ["quickfix"] });
      } finally {
        child.stdin.end();
        await new Promise<void>((resolve) => {
          const t = setTimeout(() => {
            child.kill("SIGTERM");
            resolve();
          }, 1500);
          child.once("exit", () => {
            clearTimeout(t);
            resolve();
          });
        });
        fs.rmSync(wsDir, { recursive: true, force: true });
      }
    },
    20_000,
  );

  if (skipReason) {
    it.skip(`subprocess handshake skipped: ${skipReason}`, () => undefined);
  }
});
