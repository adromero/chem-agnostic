// ---------------------------------------------------------------------------
// `chemag.addUnit` command — three-step prompt (compound -> role -> name)
// then run `chemag add unit <compound> <role> <name>`, streaming
// stdout/stderr into the chemag OutputChannel.
//
// Step 1 enumerates compounds via `loadWorkspace` + `discoverCompounds` from
// `@chemag/core`. Step 2 enumerates roles from `Workspace.roles`. Step 3 is
// a free-form input box. Cancellation at any step is a silent no-op.
//
// Loader failure (missing/invalid workspace.yaml) reports a single
// `showErrorMessage` and aborts before prompting.
//
// Note: the loader takes the FULL FILE PATH `workspace.yaml`, not the
// directory. We therefore call `loadWorkspace(path.join(workspaceDir,
// "workspace.yaml"))`.
// ---------------------------------------------------------------------------

import * as vscode from "vscode";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { discoverCompounds, loadWorkspace } from "@chemag/core";

export interface AddUnitOptions {
  cliPath: string;
  workspaceDir: string;
  output: vscode.OutputChannel;
}

export function makeAddUnitCommand(opts: AddUnitOptions): () => Promise<void> {
  return async (): Promise<void> => {
    // Step 0: load workspace.yaml + compound manifests.
    let compoundNames: string[];
    let roleNames: string[];
    try {
      const ws = loadWorkspace(path.join(opts.workspaceDir, "workspace.yaml"));
      const compounds = discoverCompounds(ws, opts.workspaceDir);
      compoundNames = compounds.map((c) => c.manifest.compound).sort();
      roleNames = Object.keys(ws.roles).sort();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.output.appendLine(`[add unit] failed to load workspace: ${msg}`);
      void vscode.window.showErrorMessage(
        `chemag: failed to load workspace.yaml — ${msg}. See the chemag output channel for details.`,
      );
      return;
    }

    if (compoundNames.length === 0) {
      void vscode.window.showWarningMessage(
        "chemag: no compounds found in workspace. Run 'chemag: Add Compound' first.",
      );
      return;
    }
    if (roleNames.length === 0) {
      void vscode.window.showWarningMessage(
        "chemag: workspace.yaml declares no roles — cannot add a unit.",
      );
      return;
    }

    // Step 1: pick compound.
    const compound = await vscode.window.showQuickPick(compoundNames, {
      placeHolder: "Compound",
    });
    if (compound === undefined) return;

    // Step 2: pick role.
    const role = await vscode.window.showQuickPick(roleNames, {
      placeHolder: "Role",
    });
    if (role === undefined) return;

    // Step 3: unit name.
    const unitName = await vscode.window.showInputBox({
      prompt: "Unit name",
      placeHolder: "e.g. CreatePayment",
      validateInput: (value) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) return "Unit name is required";
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(trimmed)) {
          return "Unit name must be alphanumeric (with optional . _ - separators)";
        }
        return null;
      },
    });
    if (unitName === undefined) return;
    const trimmedUnit = unitName.trim();

    opts.output.show(true);
    opts.output.appendLine(
      `[add unit] $ ${opts.cliPath} add unit ${compound} ${role} ${trimmedUnit}`,
    );

    const child = spawn(opts.cliPath, ["add", "unit", compound, role, trimmedUnit], {
      cwd: opts.workspaceDir,
      env: process.env,
    });

    child.stdout.on("data", (chunk: Buffer) => {
      opts.output.append(chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      opts.output.append(chunk.toString("utf8"));
    });

    child.on("error", (err) => {
      void vscode.window.showErrorMessage(`chemag: failed to launch CLI: ${err.message}`);
      opts.output.appendLine(`[add unit] spawn error: ${err.message}`);
    });

    child.on("close", (code) => {
      opts.output.appendLine(`[add unit] exit ${code ?? "?"}`);
      if (code === 0) {
        void vscode.window.showInformationMessage(
          `chemag: unit "${trimmedUnit}" (${role}) added to "${compound}"`,
        );
      } else {
        void vscode.window.showWarningMessage(
          `chemag: add unit exited with code ${code ?? "?"}. See the chemag output channel for details.`,
        );
      }
    });
  };
}
