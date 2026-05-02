// ---------------------------------------------------------------------------
// `architecture://docs/{section}` — covers all six section IDs against the
// section-mapping table from the WP-016 spec, plus the unknown-section
// (CHEM-MCP-303) error path. The roles + bonds bodies are snapshot-locked
// to detect format drift.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Session } from "../../src/index.js";
import {
  DOCS_SECTIONS,
  ResourceDocsSectionUnknownError,
  readDocs,
} from "../../src/resources/docs.js";
import { __resetForTesting as __resetVocabularyForTesting } from "@chemag/core/vocabulary";
import { __resetCacheStateForTesting } from "@chemag/core/cache";

const SAMPLE = path.join(__dirname, "..", "fixtures", "sample-workspace");

let tmpRoot: string;

beforeEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chemag-mcp-rsrc-d-"));
  process.env.CHEMAG_CACHE_DIR = path.join(tmpRoot, "cache");
});

afterEach(() => {
  __resetVocabularyForTesting();
  __resetCacheStateForTesting();
  delete process.env.CHEMAG_CACHE_DIR;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("architecture://docs/{section} — happy paths", () => {
  it("renders a markdown body for every documented section", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    for (const section of DOCS_SECTIONS) {
      const out = await readDocs(session, section);
      expect(out.uri).toBe(`architecture://docs/${section}`);
      expect(out.mimeType).toBe("text/markdown");
      expect(out.text.length).toBeGreaterThan(0);
    }
  });

  it("docs/roles renders a Role | Allowed bonds table (snapshot)", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await readDocs(session, "roles");
    expect(out.text).toMatchSnapshot();
  });

  it("docs/bonds renders the dependency-rules table (snapshot)", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await readDocs(session, "bonds");
    expect(out.text).toMatchSnapshot();
  });

  it("docs/types returns the empty-state copy when compound_types is absent", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await readDocs(session, "types");
    expect(out.text).toContain("(no compound types defined in this workspace)");
  });

  it("docs/workflow includes the chemag check pointer", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await readDocs(session, "workflow");
    expect(out.text).toContain("chemag check");
  });

  it("docs/tools lists every registered MCP tool (8 today)", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await readDocs(session, "tools");
    expect(out.text).toContain("`find_violations`");
    expect(out.text).toContain("`where_should_this_go`");
    expect(out.text).toContain("`scaffold_unit`");
  });

  it("docs/ai_rules includes the cross-module rule + DEFAULT_PATHS pointer", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    const out = await readDocs(session, "ai_rules");
    expect(out.text).toContain("AI rules");
    expect(out.text).toContain("CLAUDE.md");
    expect(out.text).toContain("AGENTS.md");
  });
});

describe("architecture://docs/{section} — error path", () => {
  it("throws CHEM-MCP-303 for an unknown section", async () => {
    const session = new Session({ workspaceDir: SAMPLE });
    let captured: unknown = null;
    try {
      await readDocs(session, "banana");
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(ResourceDocsSectionUnknownError);
    expect((captured as ResourceDocsSectionUnknownError).code).toBe("CHEM-MCP-303");
    expect((captured as ResourceDocsSectionUnknownError).section).toBe("banana");
  });
});
