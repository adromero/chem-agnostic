// ---------------------------------------------------------------------------
// `chemag.whereShouldThisGo` command — prompt for a free-text description,
// invoke the `where_should_this_go` MCP tool through the MCP bridge, and
// render ranked placement suggestions in a QuickPick.
//
// Lazy-accessor pattern: `getMcpBridge` mirrors `getLspClient` in
// `check-workspace.ts` because the bridge is constructed in `activate()`
// after the command factory is invoked AND because `mcpBridge.start()` runs
// fire-and-forget. NEVER capture the bridge by value.
//
// Disconnected handling: if the bridge accessor returns null OR the bridge
// reports `isConnected() === false` OR the wrapper throws "chemag MCP
// bridge is not connected", surface a single warning message and return —
// never propagate a crash.
//
// Selection is informational in v0 (no follow-up action — the user copies
// the placement into their next CLI/MCP call).
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import type { McpBridge } from "../mcp-bridge";

export interface WhereShouldThisGoOptions {
  output: vscode.OutputChannel;
  /**
   * Lazy accessor for the MCP bridge — the bridge is assigned in `activate()`
   * after `mcpBridge.start()` resolves and may be reassigned/cleared on
   * dispose. NEVER capture the bridge by value here.
   */
  getMcpBridge: () => McpBridge | null;
}

interface PlacementSuggestion {
  compound: string;
  role: string;
  confidence: number;
  rationale: string;
  nearest_existing_units: string[];
}

interface WhereShouldThisGoResult {
  suggestions: PlacementSuggestion[];
}

/** Standard MCP `CallToolResult.content` shape (subset we care about). */
interface CallToolEnvelope {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: WhereShouldThisGoResult;
}

const NOT_CONNECTED_WARNING = "chemag: MCP bridge is not connected. See the chemag output channel.";

export function makeWhereShouldThisGoCommand(opts: WhereShouldThisGoOptions): () => Promise<void> {
  return async (): Promise<void> => {
    const bridge = opts.getMcpBridge();
    if (!bridge || !bridge.isConnected()) {
      opts.output.appendLine("[where] MCP bridge is not connected — aborting");
      void vscode.window.showWarningMessage(NOT_CONNECTED_WARNING);
      return;
    }

    const description = await vscode.window.showInputBox({
      prompt: "Describe what you want to add",
      placeHolder: "e.g. 'a service that emails users on signup'",
    });
    if (description === undefined) return; // user cancelled — silent no-op
    const trimmed = description.trim();
    if (trimmed.length === 0) return;

    opts.output.appendLine(`[where] $ where_should_this_go ${JSON.stringify(trimmed)}`);

    let raw: unknown;
    try {
      raw = await bridge.whereShouldThisGo({ description: trimmed });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.output.appendLine(`[where] MCP call failed: ${msg}`);
      // Belt-and-braces guard for the explicit "not connected" throw and any
      // other unexpected error from the wrapper. Degrade with a warning.
      if (msg.includes("MCP bridge is not connected")) {
        void vscode.window.showWarningMessage(NOT_CONNECTED_WARNING);
      } else {
        void vscode.window.showWarningMessage(
          `chemag: where_should_this_go failed (${msg}). See the chemag output channel for details.`,
        );
      }
      return;
    }

    const result = parseEnvelope(raw, opts.output);
    if (result === null) {
      void vscode.window.showWarningMessage(
        "chemag: could not parse placement suggestions. See the chemag output channel for details.",
      );
      return;
    }

    if (result.suggestions.length === 0) {
      void vscode.window.showInformationMessage(
        "chemag: no placement suggestions for that description.",
      );
      return;
    }

    const items: vscode.QuickPickItem[] = result.suggestions.map((s) => ({
      label: `${s.compound} / ${s.role} (${Math.round(s.confidence * 100)}%)`,
      description: s.rationale,
      detail: s.nearest_existing_units.length > 0 ? s.nearest_existing_units.join(", ") : "—",
    }));

    // v0: selection is informational — user copies the placement into their
    // next CLI/MCP call. We discard the picked value intentionally.
    await vscode.window.showQuickPick(items, {
      placeHolder: "Suggested placement",
    });
  };
}

/**
 * Parse the MCP `callTool` envelope into a `WhereShouldThisGoResult`.
 *
 * The MCP spec wraps tool returns in a `CallToolResult` with a `content`
 * array — `result.content[0].text` is the JSON-encoded payload. We also
 * accept the typed `structuredContent` field as a fast path (some SDKs
 * populate it directly) and fall back to JSON-parsing the text content.
 */
function parseEnvelope(raw: unknown, output: vscode.OutputChannel): WhereShouldThisGoResult | null {
  if (raw === null || typeof raw !== "object") {
    output.appendLine(`[where] unexpected envelope shape: ${JSON.stringify(raw)}`);
    return null;
  }
  const env = raw as CallToolEnvelope;

  if (env.structuredContent && Array.isArray(env.structuredContent.suggestions)) {
    return env.structuredContent;
  }

  const first = env.content?.[0];
  if (first && typeof first.text === "string") {
    try {
      const parsed = JSON.parse(first.text) as WhereShouldThisGoResult;
      if (Array.isArray(parsed.suggestions)) return parsed;
      output.appendLine(`[where] parsed payload missing suggestions: ${first.text}`);
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      output.appendLine(`[where] failed to JSON.parse content[0].text: ${msg}`);
      return null;
    }
  }

  output.appendLine("[where] envelope had neither structuredContent nor content[0].text");
  return null;
}
