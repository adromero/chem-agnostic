// ---------------------------------------------------------------------------
// Shared fixtures for rules-emitter tests. Builds a small canonical workspace
// with two compounds so the emitter outputs are deterministic across runs.
// ---------------------------------------------------------------------------

import type { LoadedCompound, Workspace } from "../../src/types.js";

export function buildFixtureWorkspace(): Workspace {
  return {
    workspace: "fixtureapp",
    language: "typescript",
    roles: {
      element: { description: "Immutable value object", folder: "elements" },
      molecule: { description: "Domain state", folder: "molecules" },
      reaction: { description: "Workflow", folder: "reactions" },
      interface: { description: "Contract", folder: "interfaces" },
      adapter: { description: "Concrete implementation", folder: "adapters" },
      buffer: { description: "Middleware", folder: "buffers" },
    },
    bonds: {
      element: ["element"],
      molecule: ["element", "molecule"],
      reaction: ["element", "molecule", "interface"],
      interface: ["element", "molecule"],
      adapter: ["element", "molecule", "interface", "adapter"],
      buffer: ["element", "molecule", "interface"],
    },
    paths: { compounds: "./src/compounds" },
    rules: {
      cross_compound_imports: "public_only",
      role_from_path: true,
      public_surface: "public.ts",
      manifest_filename: "compound.yaml",
    },
  };
}

export function buildFixtureCompounds(): LoadedCompound[] {
  return [
    {
      manifest: {
        compound: "billing",
        type: "compound",
      },
      dir: "/tmp/fixtureapp/src/compounds/billing",
    },
    {
      manifest: {
        compound: "users",
        type: "compound",
      },
      dir: "/tmp/fixtureapp/src/compounds/users",
    },
  ];
}
