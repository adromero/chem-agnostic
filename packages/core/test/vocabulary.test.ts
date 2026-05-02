import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  __resetForTesting,
  applyWorkspaceVocabulary,
  getVocabulary,
  getVocabularySource,
  isVocabularyName,
  resolveCliVocabulary,
  setVocabulary,
  tr,
} from "../src/vocabulary/index.js";
import type { Workspace } from "../src/types.js";

beforeEach(() => {
  __resetForTesting();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Default state and getVocabulary
// ---------------------------------------------------------------------------

describe("default state", () => {
  it("starts with vocabulary=standard, source=default", () => {
    expect(getVocabulary()).toBe("standard");
    expect(getVocabularySource()).toBe("default");
  });
});

// ---------------------------------------------------------------------------
// tr()
// ---------------------------------------------------------------------------

describe("tr() — translation lookup", () => {
  it("returns the standard string for a key by default", () => {
    expect(tr("role.element")).toBe("value-object");
    expect(tr("role.molecule")).toBe("entity");
  });

  it("returns the chemistry string when chemistry vocabulary is set", () => {
    setVocabulary("chemistry", "flag");
    expect(tr("role.element")).toBe("element");
    expect(tr("role.molecule")).toBe("molecule");
  });

  it("interpolates {param} placeholders", () => {
    setVocabulary("chemistry", "flag");
    const out = tr("diagnostic.duplicate_compound", { name: "billing" });
    expect(out).toBe('Duplicate compound name "billing"');
  });

  it("interpolates multiple {params}", () => {
    setVocabulary("chemistry", "flag");
    const out = tr("diagnostic.bond_violation", {
      src_name: "createOrder",
      src_role: "reaction",
      dep: "PgRepo",
      dep_role: "adapter",
    });
    expect(out).toContain("createOrder");
    expect(out).toContain("(reaction)");
    expect(out).toContain("PgRepo");
    expect(out).toContain("(adapter)");
    expect(out).toContain("bond violation");
  });

  it("interpolates numeric params", () => {
    setVocabulary("chemistry", "flag");
    const out = tr("diagnostic.singleton_violated", {
      type: "catalyst",
      count: 2,
      names: "a, b",
    });
    expect(out).toContain("2 instances");
    expect(out).toContain("[a, b]");
  });

  it("returns [!key] and warns when key is missing in current locale", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // @ts-expect-error — intentionally invalid TrKey for this test
    const out = tr("non.existent.key");
    expect(out).toBe("[!non.existent.key]");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("non.existent.key");
  });

  it("warns only once per missing key", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // @ts-expect-error
    tr("missing.key.x");
    // @ts-expect-error
    tr("missing.key.x");
    // @ts-expect-error
    tr("missing.key.x");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("leaves unmatched {placeholder} when param is not provided", () => {
    setVocabulary("chemistry", "flag");
    const out = tr("diagnostic.duplicate_compound");
    expect(out).toContain("{name}");
  });
});

// ---------------------------------------------------------------------------
// setVocabulary precedence
// ---------------------------------------------------------------------------

describe("setVocabulary() — precedence", () => {
  it("default can be overridden by workspace", () => {
    expect(setVocabulary("chemistry", "workspace")).toBe(true);
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("workspace");
  });

  it("workspace can be overridden by env", () => {
    setVocabulary("chemistry", "workspace");
    expect(setVocabulary("standard", "env")).toBe(true);
    expect(getVocabulary()).toBe("standard");
    expect(getVocabularySource()).toBe("env");
  });

  it("env can be overridden by flag", () => {
    setVocabulary("chemistry", "env");
    expect(setVocabulary("standard", "flag")).toBe(true);
    expect(getVocabulary()).toBe("standard");
    expect(getVocabularySource()).toBe("flag");
  });

  it("flag is not overridden by env", () => {
    setVocabulary("chemistry", "flag");
    expect(setVocabulary("standard", "env")).toBe(false);
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("flag");
  });

  it("flag is not overridden by workspace", () => {
    setVocabulary("chemistry", "flag");
    expect(setVocabulary("standard", "workspace")).toBe(false);
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("flag");
  });

  it("env is not overridden by workspace", () => {
    setVocabulary("chemistry", "env");
    expect(setVocabulary("standard", "workspace")).toBe(false);
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("env");
  });

  it("equal-rank source is allowed (e.g., flag overwriting flag)", () => {
    setVocabulary("chemistry", "flag");
    expect(setVocabulary("standard", "flag")).toBe(true);
    expect(getVocabulary()).toBe("standard");
  });

  it("workspace cannot override an existing flag — Phase 2 no-op invariant", () => {
    // Phase 1 -> flag
    setVocabulary("chemistry", "flag");
    // Phase 2 -> tries workspace
    setVocabulary("standard", "workspace");
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("flag");
  });
});

// ---------------------------------------------------------------------------
// applyWorkspaceVocabulary
// ---------------------------------------------------------------------------

describe("applyWorkspaceVocabulary()", () => {
  function ws(vocabulary?: "standard" | "chemistry"): Workspace {
    return {
      workspace: "demo",
      language: "typescript",
      roles: {},
      bonds: {},
      paths: { compounds: "./src" },
      vocabulary,
    };
  }

  it("sets vocabulary from workspace when no Phase-1 source was applied", () => {
    applyWorkspaceVocabulary(ws("chemistry"));
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("workspace");
  });

  it("is a no-op when workspace.vocabulary is undefined", () => {
    applyWorkspaceVocabulary(ws());
    expect(getVocabulary()).toBe("standard");
    expect(getVocabularySource()).toBe("default");
  });

  it("is a no-op when Phase 1 already saw a flag", () => {
    setVocabulary("standard", "flag");
    applyWorkspaceVocabulary(ws("chemistry"));
    expect(getVocabulary()).toBe("standard");
    expect(getVocabularySource()).toBe("flag");
  });

  it("is a no-op when Phase 1 already saw env", () => {
    setVocabulary("standard", "env");
    applyWorkspaceVocabulary(ws("chemistry"));
    expect(getVocabulary()).toBe("standard");
    expect(getVocabularySource()).toBe("env");
  });

  it("overrides Phase-1 default with workspace value", () => {
    // Phase 1 falls back to default (no flag, no env): the call to set
    // setVocabulary("standard", "default") may still happen explicitly and
    // workspace must outrank it.
    setVocabulary("standard", "default");
    applyWorkspaceVocabulary(ws("chemistry"));
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("workspace");
  });
});

// ---------------------------------------------------------------------------
// resolveCliVocabulary — Phase 1 pure function
// ---------------------------------------------------------------------------

describe("resolveCliVocabulary()", () => {
  it("returns flag when --vocabulary <name> is present", () => {
    const r = resolveCliVocabulary(["check", "workspace.yaml", "--vocabulary", "chemistry"], {});
    expect(r).toEqual({ name: "chemistry", source: "flag" });
  });

  it("returns flag when --vocabulary=<name> is present", () => {
    const r = resolveCliVocabulary(["--vocabulary=standard"], {});
    expect(r).toEqual({ name: "standard", source: "flag" });
  });

  it("flag takes precedence over env", () => {
    const r = resolveCliVocabulary(["--vocabulary", "standard"], {
      CHEMAG_VOCABULARY: "chemistry",
    });
    expect(r).toEqual({ name: "standard", source: "flag" });
  });

  it("env takes precedence over default", () => {
    const r = resolveCliVocabulary([], { CHEMAG_VOCABULARY: "chemistry" });
    expect(r).toEqual({ name: "chemistry", source: "env" });
  });

  it("falls back to standard/default when neither flag nor env is set", () => {
    const r = resolveCliVocabulary(["check", "workspace.yaml"], {});
    expect(r).toEqual({ name: "standard", source: "default" });
  });

  it("ignores invalid flag value and falls through to env", () => {
    const r = resolveCliVocabulary(["--vocabulary", "klingon"], { CHEMAG_VOCABULARY: "chemistry" });
    expect(r).toEqual({ name: "chemistry", source: "env" });
  });

  it("ignores invalid env value and falls through to default", () => {
    const r = resolveCliVocabulary([], { CHEMAG_VOCABULARY: "klingon" });
    expect(r).toEqual({ name: "standard", source: "default" });
  });
});

// ---------------------------------------------------------------------------
// isVocabularyName
// ---------------------------------------------------------------------------

describe("isVocabularyName()", () => {
  it("accepts standard and chemistry", () => {
    expect(isVocabularyName("standard")).toBe(true);
    expect(isVocabularyName("chemistry")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isVocabularyName("klingon")).toBe(false);
    expect(isVocabularyName("")).toBe(false);
    expect(isVocabularyName(undefined)).toBe(false);
    expect(isVocabularyName(null)).toBe(false);
    expect(isVocabularyName(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// End-to-end precedence — flag > env > workspace > default
// ---------------------------------------------------------------------------

describe("end-to-end precedence", () => {
  function ws(vocabulary?: "standard" | "chemistry"): Workspace {
    return {
      workspace: "demo",
      language: "typescript",
      roles: {},
      bonds: {},
      paths: { compounds: "./src" },
      vocabulary,
    };
  }

  it("flag wins over workspace", () => {
    // Phase 1: flag
    const r = resolveCliVocabulary(["--vocabulary", "standard"], {});
    setVocabulary(r.name, r.source);
    // Phase 2: workspace says chemistry
    applyWorkspaceVocabulary(ws("chemistry"));
    expect(getVocabulary()).toBe("standard");
  });

  it("env wins over workspace", () => {
    const r = resolveCliVocabulary([], { CHEMAG_VOCABULARY: "standard" });
    setVocabulary(r.name, r.source);
    applyWorkspaceVocabulary(ws("chemistry"));
    expect(getVocabulary()).toBe("standard");
  });

  it("workspace wins over default", () => {
    const r = resolveCliVocabulary([], {});
    setVocabulary(r.name, r.source); // default
    applyWorkspaceVocabulary(ws("chemistry"));
    expect(getVocabulary()).toBe("chemistry");
  });

  it("default applies when no other source resolves a value", () => {
    const r = resolveCliVocabulary([], {});
    setVocabulary(r.name, r.source);
    applyWorkspaceVocabulary(ws()); // no field
    expect(getVocabulary()).toBe("standard");
  });

  it("flag wins over env", () => {
    const r = resolveCliVocabulary(["--vocabulary", "standard"], {
      CHEMAG_VOCABULARY: "chemistry",
    });
    setVocabulary(r.name, r.source);
    expect(getVocabulary()).toBe("standard");
  });
});

// ---------------------------------------------------------------------------
// "session" source (WP-014) — sits between default and workspace so workspace
// still wins, but a client-supplied vocabulary outranks the unset default.
// ---------------------------------------------------------------------------

describe('"session" source precedence (WP-014 MCP)', () => {
  function ws(vocabulary?: "standard" | "chemistry"): Workspace {
    return {
      workspace: "demo",
      language: "typescript",
      roles: {},
      bonds: {},
      paths: { compounds: "./src" },
      vocabulary,
    };
  }

  it("session overrides the default source", () => {
    expect(getVocabularySource()).toBe("default");
    expect(setVocabulary("chemistry", "session")).toBe(true);
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("session");
  });

  it("workspace beats session — workspace.yaml is the source of truth", () => {
    setVocabulary("chemistry", "session");
    applyWorkspaceVocabulary(ws("standard"));
    expect(getVocabulary()).toBe("standard");
    expect(getVocabularySource()).toBe("workspace");
  });

  it("flag beats session — operator override stays sticky", () => {
    setVocabulary("chemistry", "flag");
    expect(setVocabulary("standard", "session")).toBe(false);
    expect(getVocabulary()).toBe("chemistry");
    expect(getVocabularySource()).toBe("flag");
  });
});
