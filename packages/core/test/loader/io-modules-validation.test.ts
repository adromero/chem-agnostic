// ---------------------------------------------------------------------------
// `loadWorkspaceWithDiagnostics` — validation of `rules.io_modules` regex
// strings. The loader emits CHEM-MANIFEST-005 for any pattern that fails to
// compile, prunes the offending entry, and lets the rest of the workspace
// load normally. Hard schema errors (missing `workspace:`, ...) still throw
// from the underlying `loadWorkspace`.
// ---------------------------------------------------------------------------
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadWorkspaceWithDiagnostics } from "../../src/loader.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-io-modules-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeWorkspaceYaml(content: string): string {
  const p = path.join(tmpDir, "workspace.yaml");
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

const VALID_BASE = `workspace: io-modules-test
language: typescript
roles:
  reaction:
    description: Workflow
    folder: reactions
  adapter:
    description: Implementation
    folder: adapters
bonds:
  reaction: []
  adapter: []
paths:
  compounds: ./src/compounds
`;

describe("loadWorkspaceWithDiagnostics — rules.io_modules validation", () => {
  it("loads cleanly with a valid io_modules entry", () => {
    const wsPath = writeWorkspaceYaml(
      `${VALID_BASE}rules:
  io_modules:
    - "^kafka-node$"
`,
    );
    const { workspace, diagnostics } = loadWorkspaceWithDiagnostics(wsPath);
    expect(diagnostics).toEqual([]);
    expect(workspace.rules?.io_modules).toEqual(["^kafka-node$"]);
  });

  it("surfaces CHEM-MANIFEST-005 for an invalid regex without throwing", () => {
    const wsPath = writeWorkspaceYaml(
      `${VALID_BASE}rules:
  io_modules:
    - "[unterminated"
`,
    );
    const { workspace, diagnostics } = loadWorkspaceWithDiagnostics(wsPath);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("CHEM-MANIFEST-005");
    expect(diagnostics[0].level).toBe("error");
    expect(diagnostics[0].message).toContain("[unterminated");
    expect(diagnostics[0].file).toBe(wsPath);
    // Offending entry pruned from in-memory rules.
    expect(workspace.rules?.io_modules).toEqual([]);
  });

  it("prunes only the invalid entry; valid entries reach the analyze phase", () => {
    const wsPath = writeWorkspaceYaml(
      `${VALID_BASE}rules:
  io_modules:
    - "^kafka-node$"
    - "[unterminated"
    - "^pulsar-client$"
`,
    );
    const { workspace, diagnostics } = loadWorkspaceWithDiagnostics(wsPath);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("CHEM-MANIFEST-005");
    expect(workspace.rules?.io_modules).toEqual(["^kafka-node$", "^pulsar-client$"]);
  });
});
