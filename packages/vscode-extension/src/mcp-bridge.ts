// ---------------------------------------------------------------------------
// MCP bridge — spawns `chemag mcp` as a child process and connects via the
// MCP SDK's StdioClientTransport. The transport handles the spawn itself
// (we pass StdioServerParameters); we just keep references for shutdown.
//
// v0.1 exposes typed `whereShouldThisGo` / `validateEdit` wrappers. No
// command consumes them yet — wp-027 will. The bridge proves it can boot
// and answer `tools/list` during activation.
//
// Lifecycle:
//   - activate: spawn + connect, with up to 3 exponential-backoff restarts
//     (1s, 2s, 4s, capped 30s) on unexpected close/error.
//   - deactivate: client.close() — the transport closes and kills the child.
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MAX_RESTARTS = 3;
/** Backoff schedule in ms — index = restart attempt (0-based). Capped at 30s. */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export interface McpBridgeOptions {
  /** Resolved absolute path or PATH-resolvable name of the chemag binary. */
  cliPath: string;
  /** Absolute workspace folder path (parent of workspace.yaml). */
  workspaceDir: string;
  /** OutputChannel used for life-cycle telemetry. */
  output: vscode.OutputChannel;
}

export class McpBridge implements vscode.Disposable {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private restartCount = 0;
  private disposed = false;
  private startInFlight: Promise<void> | null = null;

  constructor(private readonly opts: McpBridgeOptions) {}

  /**
   * Boot the bridge and verify it answers `tools/list`. Resolves once the
   * connection is established; rejects on the initial connect failure (no
   * restart attempted on the first failure — caller decides what to do).
   */
  async start(): Promise<void> {
    if (this.startInFlight) return this.startInFlight;
    this.startInFlight = this.startInternal();
    try {
      await this.startInFlight;
    } finally {
      this.startInFlight = null;
    }
  }

  private async startInternal(): Promise<void> {
    if (this.disposed) return;

    const transport = new StdioClientTransport({
      command: this.opts.cliPath,
      args: ["mcp", "--workspace", this.opts.workspaceDir],
      // stderr "pipe" so we can forward to the OutputChannel; otherwise it
      // would default to "inherit" and clutter the extension host stderr.
      stderr: "pipe",
    });

    const client = new Client({ name: "chemag-vscode", version: "0.1.0" }, { capabilities: {} });

    // Wire onclose BEFORE connect so a fast-fail spawn surfaces through the
    // restart path rather than dropping silently.
    transport.onclose = (): void => {
      this.handleUnexpectedClose();
    };
    transport.onerror = (err: Error): void => {
      this.opts.output.appendLine(`[mcp] transport error: ${err.message}`);
    };

    await client.connect(transport);

    // Pipe child stderr into the OutputChannel for diagnosability.
    const stderr = transport.stderr;
    if (stderr) {
      stderr.on("data", (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        this.opts.output.append(`[mcp:stderr] ${text}`);
      });
    }

    this.client = client;
    this.transport = transport;

    // Smoke-check: list tools so a misbehaving server fails fast at activation
    // rather than at first wrapper call.
    const tools = await client.listTools();
    this.opts.output.appendLine(`[mcp] connected — ${tools.tools.length} tool(s) available`);

    // Connection healthy — reset the restart counter so a future close gets
    // its own fresh backoff schedule.
    this.restartCount = 0;
  }

  /**
   * Restart on unexpected close. Skips if we're shutting down or already
   * starting. Uses exponential backoff capped at 30s; surfaces a
   * showErrorMessage after the 3rd failed attempt and stays down.
   */
  private handleUnexpectedClose(): void {
    if (this.disposed) return;
    if (this.restartCount >= MAX_RESTARTS) {
      this.opts.output.appendLine("[mcp] gave up after 3 restart attempts — bridge offline");
      void vscode.window.showErrorMessage(
        "chemag: MCP bridge crashed repeatedly and is now offline. Check the chemag output channel for details.",
      );
      return;
    }

    const attempt = this.restartCount;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    this.restartCount += 1;
    this.client = null;
    this.transport = null;

    this.opts.output.appendLine(`[mcp] restart ${this.restartCount}/${MAX_RESTARTS} in ${delay}ms`);
    setTimeout(() => {
      if (this.disposed) return;
      this.startInternal().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.opts.output.appendLine(`[mcp] restart failed: ${msg}`);
      });
    }, delay);
  }

  /** Wrapper around the `where_should_this_go` MCP tool. Reserved for wp-027. */
  async whereShouldThisGo(input: unknown): Promise<unknown> {
    if (!this.client) throw new Error("chemag MCP bridge is not connected");
    return this.client.callTool({
      name: "where_should_this_go",
      arguments: input as Record<string, unknown>,
    });
  }

  /** Wrapper around the `validate_edit` MCP tool. Reserved for wp-027. */
  async validateEdit(input: unknown): Promise<unknown> {
    if (!this.client) throw new Error("chemag MCP bridge is not connected");
    return this.client.callTool({
      name: "validate_edit",
      arguments: input as Record<string, unknown>,
    });
  }

  /** True once `start()` has resolved and the client/transport are live. */
  isConnected(): boolean {
    return this.client !== null;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const client = this.client;
    this.client = null;
    this.transport = null;
    if (client) {
      try {
        await client.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.opts.output.appendLine(`[mcp] close error: ${msg}`);
      }
    }
  }
}
