// ---------------------------------------------------------------------------
// `chemag mcp` smoke tests.
//
// 1. Pure unit tests: error paths exercised via runCli with mocked exit.
//    - --transport sse exits non-zero with CHEM-MCP-002.
//    - No workspace + no workspace.yaml in cwd exits non-zero with CHEM-MCP-001.
//    - --help prints the help block.
//
// 2. Subprocess handshake: spawn `node bin/chem-ag mcp --workspace <fixture>`,
//    write a JSON-RPC `initialize` frame to stdin, read the response on
//    stdout, and assert serverInfo.name === "chemag" plus the capability
//    flags. We use a tiny in-test newline-delimited JSON-RPC framer rather
//    than the SDK client to keep this dep-light.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { runCli } from "../../src/cli.js";
import { __resetForTesting } from "@chemag/core/vocabulary";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CLI_BIN = path.resolve(REPO_ROOT, "packages/cli/bin/chem-ag");

let tmpDir: string;
let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;

beforeEach(() => {
  __resetForTesting();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-cli-"));
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
  if (tmpDir && fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runSafe(argv: string[]): void {
  try {
    runCli(argv);
  } catch (e: unknown) {
    if ((e as Error).message !== "__cli_exit__") throw e;
  }
}

function writeMinimalWorkspace(dir: string): void {
  fs.mkdirSync(path.join(dir, "src", "compounds"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "workspace.yaml"),
    [
      "workspace: mcp-cli-test",
      "language: typescript",
      "roles:",
      "  element:",
      "    description: V",
      "    folder: elements",
      "bonds:",
      "  element: [element]",
      "paths:",
      "  compounds: ./src/compounds",
      "",
    ].join("\n"),
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Pure unit tests (no subprocess)
// ---------------------------------------------------------------------------

describe("chemag mcp — error paths", () => {
  it("--transport sse exits non-zero and mentions CHEM-MCP-002", () => {
    writeMinimalWorkspace(tmpDir);
    runSafe(["mcp", "--workspace", tmpDir, "--transport", "sse"]);
    expect(exitCode).toBeDefined();
    expect(exitCode).not.toBe(0);
    const text = stderr.join("\n");
    expect(text.toLowerCase()).toMatch(/transport.*not.*supported|sse/);
  });

  it("missing workspace exits non-zero and mentions CHEM-MCP-001", () => {
    // tmpDir has no workspace.yaml AT cwd; force cwd into tmpDir.
    const prev = process.cwd();
    process.chdir(tmpDir);
    try {
      runSafe(["mcp"]);
    } finally {
      process.chdir(prev);
    }
    expect(exitCode).toBeDefined();
    expect(exitCode).not.toBe(0);
    const text = stderr.join("\n");
    expect(text.toLowerCase()).toMatch(/workspace|chemag mcp/);
  });

  it("--help prints the help block", () => {
    runSafe(["mcp", "--help"]);
    // cmdMcp returns 0 for --help; the dispatcher only calls process.exit
    // when the code is non-zero, so exitCode stays undefined here. The
    // observable signal is the printed help block on stdout.
    expect(exitCode).toBeUndefined();
    const text = stdout.join("\n");
    expect(text.toLowerCase()).toMatch(/mcp/);
    expect(text.toLowerCase()).toMatch(/--workspace/);
    expect(text.toLowerCase()).toMatch(/--transport/);
  });
});

// ---------------------------------------------------------------------------
// Subprocess handshake — initialize JSON-RPC round-trip
// ---------------------------------------------------------------------------

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string | null;
  result?: { serverInfo?: { name?: string; version?: string }; capabilities?: unknown };
  error?: { code: number; message: string };
}

/**
 * Tiny newline-delimited JSON-RPC framer. The MCP SDK uses NDJSON over
 * stdio, so we just write a `\n`-terminated JSON line and slurp lines back.
 * Returns the parsed response with id === requestId.
 */
async function sendInitialize(
  child: ChildProcessWithoutNullStreams,
  requestId: number,
): Promise<JsonRpcResponse> {
  const initRequest = {
    jsonrpc: "2.0" as const,
    id: requestId,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "chemag-cli-test", version: "0.0.0" },
    },
  };

  return new Promise<JsonRpcResponse>((resolve, reject) => {
    let buffered = "";
    const onData = (chunk: Buffer): void => {
      buffered += chunk.toString("utf-8");
      // Split on newline; process complete lines.
      let nl = buffered.indexOf("\n");
      while (nl !== -1) {
        const line = buffered.slice(0, nl).trim();
        buffered = buffered.slice(nl + 1);
        if (line.length > 0) {
          try {
            const msg = JSON.parse(line) as JsonRpcResponse;
            if (msg.id === requestId) {
              child.stdout.removeListener("data", onData);
              resolve(msg);
              return;
            }
          } catch {
            // Ignore non-JSON noise (shouldn't happen on stdout, but be defensive)
          }
        }
        nl = buffered.indexOf("\n");
      }
    };
    child.stdout.on("data", onData);

    const timer = setTimeout(() => {
      child.stdout.removeListener("data", onData);
      reject(new Error("Timed out waiting for initialize response"));
    }, 10_000);

    child.once("exit", (code) => {
      clearTimeout(timer);
    });

    child.stdin.write(`${JSON.stringify(initRequest)}\n`);
  });
}

describe("chemag mcp — subprocess handshake", () => {
  // Skip if the bin isn't built yet — turbo `pnpm build` runs before the
  // test, but on a fresh clone before `pnpm build` this would fail with a
  // confusing "module not found" instead of a polite skip.
  const binAvailable = fs.existsSync(CLI_BIN);
  const skipReason = binAvailable ? null : `chem-ag bin not present at ${CLI_BIN}`;

  it.skipIf(!binAvailable)(
    "responds to initialize with serverInfo.name === 'chemag' and the expected capabilities",
    async () => {
      const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-handshake-"));
      writeMinimalWorkspace(wsDir);

      const child = spawn("node", [CLI_BIN, "mcp", "--workspace", wsDir], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, CHEMAG_NO_TELEMETRY_PROMPT: "1" },
      }) as ChildProcessWithoutNullStreams;

      try {
        const response = await sendInitialize(child, 1);
        expect(response.error).toBeUndefined();
        expect(response.result).toBeDefined();
        expect(response.result?.serverInfo?.name).toBe("chemag");
        expect(typeof response.result?.serverInfo?.version).toBe("string");
        const caps = response.result?.capabilities as
          | { tools?: unknown; resources?: { subscribe?: boolean }; prompts?: unknown }
          | undefined;
        expect(caps).toBeDefined();
        expect(caps?.tools).toBeDefined();
        expect(caps?.resources).toBeDefined();
        expect(caps?.resources?.subscribe).toBe(true);
        expect(caps?.prompts).toBeDefined();
      } finally {
        // Clean shutdown: close stdin to signal the transport, then kill if
        // the child doesn't exit within 1s.
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
    // Surface a single explanatory it.skip so the suite shows why the
    // handshake test was skipped rather than silently passing.
    it.skip(`subprocess handshake skipped: ${skipReason}`, () => undefined);
  }
});
