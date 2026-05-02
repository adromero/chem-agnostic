// CI smoke test for the MCP server's `where_should_this_go` tool.
//
// Spawns `chemag mcp --workspace .` from the cwd, sends an `initialize`
// JSON-RPC frame followed by `tools/call where_should_this_go`, and asserts
// the response contains a non-empty `suggestions` array whose top entry
// suggests one of the billing or integrations compounds.
//
// Run from the directory whose `workspace.yaml` should be analyzed (in CI,
// that's apps/reference-monorepo/).
//
// Exits 0 on success, 1 on any failure (timeout, missing fields, wrong
// compound suggestion).

import { spawn } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";

const TIMEOUT_MS = 15_000;

async function main() {
  // Resolve the chem-ag bin via require.resolve to support both the
  // dist-built repo path and a globally-linked install.
  const { fileURLToPath } = await import("node:url");
  const here = fileURLToPath(new URL(".", import.meta.url));
  const repoRoot = path.resolve(here, "..");
  const localBin = path.join(repoRoot, "packages/cli/bin/chem-ag");
  const cliBin = fs.existsSync(localBin) ? localBin : "chemag";

  const cwd = process.cwd();
  const child = spawn("node", [cliBin, "mcp", "--workspace", cwd, "--no-telemetry"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, CHEMAG_NO_TELEMETRY: "1" },
  });

  // Buffer stderr for diagnostics on failure.
  const stderrChunks = [];
  child.stderr.on("data", (c) => stderrChunks.push(c.toString()));

  const responses = new Map();
  let buffered = "";
  child.stdout.on("data", (chunk) => {
    buffered += chunk.toString("utf-8");
    let nl = buffered.indexOf("\n");
    while (nl !== -1) {
      const line = buffered.slice(0, nl).trim();
      buffered = buffered.slice(nl + 1);
      if (line.length > 0) {
        try {
          const msg = JSON.parse(line);
          if (msg.id !== undefined) {
            responses.set(msg.id, msg);
          }
        } catch {
          // Ignore non-JSON noise.
        }
      }
      nl = buffered.indexOf("\n");
    }
  });

  function send(req) {
    child.stdin.write(`${JSON.stringify(req)}\n`);
  }

  function waitFor(id) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for response id=${id}`));
      }, TIMEOUT_MS);
      const tick = () => {
        if (responses.has(id)) {
          clearTimeout(timer);
          resolve(responses.get(id));
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  try {
    // 1. initialize handshake
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "wp018-smoke", version: "0.0.0" },
      },
    });
    const initResp = await waitFor(1);
    if (!initResp.result?.serverInfo?.name) {
      throw new Error("initialize response missing serverInfo.name");
    }

    // 2. notifications/initialized (post-init notification per the protocol).
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`,
    );

    // 3. tools/call where_should_this_go
    send({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "where_should_this_go",
        arguments: { description: "add a Stripe payment flow" },
      },
    });
    const callResp = await waitFor(2);

    if (callResp.error) {
      throw new Error(`tools/call returned error: ${JSON.stringify(callResp.error)}`);
    }
    // Result shape: { content: [{ type: "text", text: "..." }, ...] } per MCP.
    const result = callResp.result;
    if (!result) throw new Error("tools/call response missing `result` field");

    // The MCP SDK serializes structured results into content[0].text as JSON.
    const blob = result.structuredContent ?? result;
    let parsed = blob;
    if (typeof blob === "object" && Array.isArray(blob.content)) {
      const textBlock = blob.content.find((b) => b?.type === "text");
      if (textBlock?.text) parsed = JSON.parse(textBlock.text);
    }

    const suggestions = parsed?.suggestions;
    if (!Array.isArray(suggestions) || suggestions.length === 0) {
      throw new Error(`Expected non-empty suggestions; got ${JSON.stringify(parsed)}`);
    }
    const top = suggestions[0];
    if (typeof top.compound !== "string" || typeof top.role !== "string") {
      throw new Error(`Top suggestion missing compound/role: ${JSON.stringify(top)}`);
    }

    // Acceptance: the top suggestion should be in billing or integrations.
    const acceptable = new Set(["billing", "integrations"]);
    if (!acceptable.has(top.compound)) {
      throw new Error(
        `Expected top suggestion compound in {billing, integrations}, got "${top.compound}"`,
      );
    }
    process.stdout.write(
      `[mcp-smoke] ok — top suggestion: ${top.compound}/${top.role} (confidence ${top.confidence})\n`,
    );
    process.exitCode = 0;
  } catch (err) {
    process.stderr.write(`[mcp-smoke] FAIL: ${String(err)}\n`);
    if (stderrChunks.length) {
      process.stderr.write(`[mcp-smoke] server stderr:\n${stderrChunks.join("")}\n`);
    }
    process.exitCode = 1;
  } finally {
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  }
}

main();
