import { describe, it, expect } from "vitest";
import { classifyPath } from "../../src/utils/path-classification.js";

/**
 * Tests for `classifyPath` using fixture shapes matching the
 * packages/core/test/fixtures/semantic-rules/port-001/invalid/missing-port/
 * layout:
 *
 *   <compoundsRoot>/
 *     vendors/
 *       adapters/
 *         store.ts        → compound: "vendors", role: "adapter"
 *       reactions/
 *         handlers.ts     → compound: "vendors", role: "reaction"
 *     orders/
 *       interfaces/
 *         repository.ts   → compound: "orders", role: "interface"
 *     orders/
 *       catalysts/
 *         binder.ts       → compound: "orders", role: "catalyst"
 */
describe("classifyPath", () => {
  const compoundsRoot = "/project/src/compounds";

  // ------------------------------------------------------------------
  // Fixture shape 1: adapter role (mirrors vendors/adapters/store.ts)
  // ------------------------------------------------------------------
  it("classifies an adapter file correctly", () => {
    const result = classifyPath("/project/src/compounds/vendors/adapters/store.ts", {
      compoundsRoot,
    });
    expect(result).toEqual({ compound: "vendors", role: "adapter" });
  });

  // ------------------------------------------------------------------
  // Fixture shape 2: reaction role (mirrors vendors/reactions/handlers.ts)
  // ------------------------------------------------------------------
  it("classifies a reaction file correctly", () => {
    const result = classifyPath("/project/src/compounds/vendors/reactions/handlers.ts", {
      compoundsRoot,
    });
    expect(result).toEqual({ compound: "vendors", role: "reaction" });
  });

  // ------------------------------------------------------------------
  // Fixture shape 3: interface role
  // ------------------------------------------------------------------
  it("classifies an interface file correctly", () => {
    const result = classifyPath("/project/src/compounds/orders/interfaces/repository.ts", {
      compoundsRoot,
    });
    expect(result).toEqual({ compound: "orders", role: "interface" });
  });

  // ------------------------------------------------------------------
  // Catalyst role
  // ------------------------------------------------------------------
  it("classifies a catalyst file correctly", () => {
    const result = classifyPath("/project/src/compounds/orders/catalysts/binder.ts", {
      compoundsRoot,
    });
    expect(result).toEqual({ compound: "orders", role: "catalyst" });
  });

  // ------------------------------------------------------------------
  // Custom role folder names via opts
  // ------------------------------------------------------------------
  it("uses custom role folder names when provided", () => {
    const result = classifyPath("/project/src/compounds/billing/ports/gateway.ts", {
      compoundsRoot,
      interfacePaths: ["ports"],
    });
    expect(result).toEqual({ compound: "billing", role: "interface" });
  });

  // ------------------------------------------------------------------
  // Path outside compoundsRoot → compound null, role unknown
  // ------------------------------------------------------------------
  it("returns null compound for paths outside compoundsRoot", () => {
    const result = classifyPath("/project/src/shared/some-util.ts", { compoundsRoot });
    expect(result).toEqual({ compound: null, role: "unknown" });
  });

  // ------------------------------------------------------------------
  // Path at compoundsRoot itself (no compound segment)
  // ------------------------------------------------------------------
  it("returns null compound for path equal to compoundsRoot", () => {
    const result = classifyPath("/project/src/compounds", { compoundsRoot });
    expect(result).toEqual({ compound: null, role: "unknown" });
  });

  // ------------------------------------------------------------------
  // Path at compound root with no role segment → role unknown
  // ------------------------------------------------------------------
  it("returns unknown role for a file directly in the compound root", () => {
    const result = classifyPath("/project/src/compounds/vendors/compound.yaml", {
      compoundsRoot,
    });
    expect(result).toEqual({ compound: "vendors", role: "unknown" });
  });

  // ------------------------------------------------------------------
  // Unknown role segment → role unknown (compound still extracted)
  // ------------------------------------------------------------------
  it("returns unknown role for unrecognised role segment", () => {
    const result = classifyPath("/project/src/compounds/vendors/helpers/util.ts", {
      compoundsRoot,
    });
    expect(result).toEqual({ compound: "vendors", role: "unknown" });
  });

  // ------------------------------------------------------------------
  // Sibling directory that starts with compoundsRoot name must NOT match
  // ------------------------------------------------------------------
  it("does not misclassify a sibling directory that starts with compoundsRoot name", () => {
    const result = classifyPath("/project/src/compounds2/vendors/adapters/store.ts", {
      compoundsRoot,
    });
    expect(result).toEqual({ compound: null, role: "unknown" });
  });
});
