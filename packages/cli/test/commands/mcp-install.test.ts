// ---------------------------------------------------------------------------
// `chemag mcp install/uninstall/status` integration tests.
//
// Asserts the spec's 17 criteria (subset that's CLI-level — adapter-level
// criteria are covered by the per-adapter test files).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { runCli } from "../../src/cli.js";
import { __resetForTesting } from "@chemag/core/vocabulary";
import { hasChemagServer } from "../../src/installers/mcp/_json-merge.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SCHEMA_PATH = path.resolve(REPO_ROOT, "packages/core/schemas/mcp-status.schema.json");

let tmpDir: string;
let stdout: string[];
let stderr: string[];
let exitCode: number | undefined;

beforeEach(() => {
  __resetForTesting();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-install-cli-"));
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

// ---------------------------------------------------------------------------
// install — Path B (no `claude` on PATH; --no-cli forces JSON write)
// ---------------------------------------------------------------------------

describe("chemag mcp install — Path B via --no-cli", () => {
  it("writes .mcp.json with chemag-tagged entry; exit 0", () => {
    runSafe(["mcp", "install", "--client", "claude", "--workspace", tmpDir, "--no-cli"]);
    expect(exitCode).toBeUndefined(); // dispatch returned 0; cli only exits non-zero
    const cfgPath = path.join(tmpDir, ".mcp.json");
    expect(fs.existsSync(cfgPath)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as Record<string, unknown>;
    expect(hasChemagServer(parsed)).toBe(true);
  });

  it("idempotent — running twice produces byte-equal config (criterion 5)", () => {
    runSafe(["mcp", "install", "--client", "claude", "--workspace", tmpDir, "--no-cli"]);
    const first = fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8");
    runSafe(["mcp", "install", "--client", "claude", "--workspace", tmpDir, "--no-cli"]);
    const second = fs.readFileSync(path.join(tmpDir, ".mcp.json"), "utf-8");
    expect(second).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// uninstall — preserves non-chemag entries (criterion 6)
// ---------------------------------------------------------------------------

describe("chemag mcp uninstall", () => {
  it("removes mcpServers.chemag; preserves user-managed entries", () => {
    runSafe(["mcp", "install", "--client", "claude", "--workspace", tmpDir, "--no-cli"]);
    const cfgPath = path.join(tmpDir, ".mcp.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as {
      mcpServers: Record<string, unknown>;
    };
    cfg.mcpServers.user = { command: "x", args: [] };
    fs.writeFileSync(cfgPath, `${JSON.stringify(cfg, null, 2)}\n`);

    runSafe(["mcp", "uninstall", "--client", "claude", "--workspace", tmpDir, "--no-cli"]);

    const after = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(after.mcpServers.chemag).toBeUndefined();
    expect(after.mcpServers.user).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// status (pretty) — criterion 7
// ---------------------------------------------------------------------------

describe("chemag mcp status — pretty (default)", () => {
  it("outputs a table including all clients with registered status", () => {
    runSafe(["mcp", "status", "--workspace", tmpDir]);
    const text = stdout.join("\n").toLowerCase();
    expect(text).toContain("claude");
    expect(text).toContain("cursor");
    expect(text).toContain("cline");
    expect(text).toContain("continue");
  });
});

// ---------------------------------------------------------------------------
// status --format json — criterion 8 (validates against the public schema)
// ---------------------------------------------------------------------------

describe("chemag mcp status --format json", () => {
  it("output validates against packages/core/schemas/mcp-status.schema.json", () => {
    runSafe(["mcp", "status", "--workspace", tmpDir, "--format", "json"]);

    // Find the JSON line — it's the most recent stdout line that parses as JSON.
    const jsonLine = stdout.find((l) => l.trim().startsWith("{"));
    expect(jsonLine).toBeDefined();
    const output = JSON.parse(jsonLine ?? "{}") as Record<string, unknown>;

    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8")) as object;
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(schema);
    const ok = validate(output);
    if (!ok) {
      throw new Error(`schema validation failed: ${JSON.stringify(validate.errors, null, 2)}`);
    }
    expect(ok).toBe(true);

    expect(Array.isArray((output as { clients: unknown }).clients)).toBe(true);
    const clients = (output as { clients: { client: string }[] }).clients;
    expect(clients.length).toBe(4);
    const ids = clients.map((c) => c.client).sort();
    expect(ids).toEqual(["claude", "cline", "continue", "cursor"]);
  });
});

// ---------------------------------------------------------------------------
// --client all — criterion 9 (fan-out, idempotent)
// ---------------------------------------------------------------------------

describe("chemag mcp install --client all", () => {
  it("runs all 4 adapters; per-client outcome surfaced; exit 0", () => {
    runSafe(["mcp", "install", "--client", "all", "--workspace", tmpDir, "--no-cli"]);
    expect(exitCode).toBeUndefined();
    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".cursor", "mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".cline", "mcp.json"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, ".continue", "mcpServers.json"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Unknown client → CHEM-MCP-201 (criterion 10)
// ---------------------------------------------------------------------------

describe("chemag mcp install — unknown client", () => {
  it("emits CHEM-MCP-201 and exits non-zero", () => {
    runSafe(["mcp", "install", "--client", "bogus-client", "--workspace", tmpDir, "--no-cli"]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("CHEM-MCP-201");
  });
});

// ---------------------------------------------------------------------------
// Invalid existing config JSON → CHEM-MCP-202 (criterion 11)
// ---------------------------------------------------------------------------

describe("chemag mcp install — config file invalid JSON", () => {
  it("surfaces CHEM-MCP-202 and leaves the file untouched", () => {
    const cfgPath = path.join(tmpDir, ".mcp.json");
    fs.writeFileSync(cfgPath, "not valid json {");
    runSafe(["mcp", "install", "--client", "claude", "--workspace", tmpDir, "--no-cli"]);
    expect(exitCode).toBe(2);
    expect(stderr.join("\n")).toContain("CHEM-MCP-202");
    expect(fs.readFileSync(cfgPath, "utf-8")).toBe("not valid json {");
  });
});

// ---------------------------------------------------------------------------
// --help — criterion 13
// ---------------------------------------------------------------------------

describe("chemag mcp install --help / uninstall --help / status --help", () => {
  it("`mcp install --help` shows --no-cli and --client", () => {
    runSafe(["mcp", "install", "--help"]);
    const text = stdout.join("\n");
    expect(text).toContain("--no-cli");
    expect(text).toContain("--client");
  });

  it("`mcp uninstall --help` shows --no-cli and --client", () => {
    runSafe(["mcp", "uninstall", "--help"]);
    const text = stdout.join("\n");
    expect(text).toContain("--no-cli");
    expect(text).toContain("--client");
  });

  it("`mcp status --help` shows --format", () => {
    runSafe(["mcp", "status", "--help"]);
    const text = stdout.join("\n");
    expect(text).toContain("--format");
  });
});

// ---------------------------------------------------------------------------
// Dry-run does not write
// ---------------------------------------------------------------------------

describe("chemag mcp install --dry-run", () => {
  it("does not write any config file", () => {
    runSafe(["mcp", "install", "--client", "all", "--workspace", tmpDir, "--no-cli", "--dry-run"]);
    expect(fs.existsSync(path.join(tmpDir, ".mcp.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".cursor", "mcp.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".cline", "mcp.json"))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, ".continue", "mcpServers.json"))).toBe(false);
  });
});
