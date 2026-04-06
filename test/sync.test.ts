import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { syncWorkspace } from "../src/sync.js";
import { typescriptPlugin } from "../plugins/typescript/index.js";
import type { Workspace } from "../src/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "chem-sync-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function minWs(): Workspace {
  return {
    workspace: "test",
    language: "typescript",
    roles: {
      element: { description: "Value", folder: "elements" },
      molecule: { description: "State", folder: "molecules" },
      reaction: { description: "Workflow", folder: "reactions" },
      interface: { description: "Contract", folder: "interfaces" },
      adapter: { description: "Impl", folder: "adapters" },
    },
    bonds: {
      element: ["element"],
      molecule: ["element", "molecule"],
      reaction: ["element", "molecule", "interface"],
      interface: ["element", "molecule"],
      adapter: ["element", "molecule", "interface", "adapter"],
    },
    paths: { compounds: "./compounds" },
    rules: { manifest_filename: "compound.yaml" },
  };
}

const plugin = typescriptPlugin;

describe("syncWorkspace", () => {
  it("generates manifest for compound without one", () => {
    // Create a compound directory with a role folder and .ts file
    const compoundDir = path.join(tmpDir, "compounds", "billing");
    const elemDir = path.join(compoundDir, "elements");
    fs.mkdirSync(elemDir, { recursive: true });
    fs.writeFileSync(
      path.join(elemDir, "InvoiceId.ts"),
      "export class InvoiceId {}",
      "utf-8",
    );

    const result = syncWorkspace(minWs(), tmpDir, plugin, false);
    expect(result.created).toHaveLength(1);

    const manifest = fs.readFileSync(
      path.join(compoundDir, "compound.yaml"),
      "utf-8",
    );
    expect(manifest).toContain("compound: billing");
    expect(manifest).toContain("name: InvoiceId");
    expect(manifest).toContain("role: element");
  });

  it("skips directories that already have manifests", () => {
    const compoundDir = path.join(tmpDir, "compounds", "existing");
    fs.mkdirSync(compoundDir, { recursive: true });
    fs.writeFileSync(
      path.join(compoundDir, "compound.yaml"),
      "compound: existing\nunits: []",
      "utf-8",
    );

    const result = syncWorkspace(minWs(), tmpDir, plugin, false);
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });

  it("dry-run does not write files", () => {
    const compoundDir = path.join(tmpDir, "compounds", "billing");
    const elemDir = path.join(compoundDir, "elements");
    fs.mkdirSync(elemDir, { recursive: true });
    fs.writeFileSync(
      path.join(elemDir, "InvoiceId.ts"),
      "export class InvoiceId {}",
      "utf-8",
    );

    const result = syncWorkspace(minWs(), tmpDir, plugin, true);
    expect(result.created).toHaveLength(1);
    expect(
      fs.existsSync(path.join(compoundDir, "compound.yaml")),
    ).toBe(false);
  });

  it("infers implements from adapter class", () => {
    const compoundDir = path.join(tmpDir, "compounds", "billing");
    const adapterDir = path.join(compoundDir, "adapters");
    const ifaceDir = path.join(compoundDir, "interfaces");
    fs.mkdirSync(adapterDir, { recursive: true });
    fs.mkdirSync(ifaceDir, { recursive: true });
    fs.writeFileSync(
      path.join(ifaceDir, "PaymentGateway.ts"),
      "export interface PaymentGateway {}",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(adapterDir, "StripeGateway.ts"),
      "export class StripeGateway implements PaymentGateway {}",
      "utf-8",
    );

    syncWorkspace(minWs(), tmpDir, plugin, false);
    const manifest = fs.readFileSync(
      path.join(compoundDir, "compound.yaml"),
      "utf-8",
    );
    expect(manifest).toContain("PaymentGateway");
    expect(manifest).toContain("implements");
  });

  it("excludes test files from units", () => {
    const compoundDir = path.join(tmpDir, "compounds", "billing");
    const elemDir = path.join(compoundDir, "elements");
    fs.mkdirSync(elemDir, { recursive: true });
    fs.writeFileSync(
      path.join(elemDir, "InvoiceId.ts"),
      "export class InvoiceId {}",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(elemDir, "InvoiceId.test.ts"),
      "test",
      "utf-8",
    );

    syncWorkspace(minWs(), tmpDir, plugin, false);
    const manifest = fs.readFileSync(
      path.join(compoundDir, "compound.yaml"),
      "utf-8",
    );
    // Should have InvoiceId but not InvoiceId.test
    expect(manifest).toContain("name: InvoiceId");
    expect(manifest).not.toContain("InvoiceId.test");
  });
});
