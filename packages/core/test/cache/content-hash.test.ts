import { describe, expect, it } from "vitest";
import { contentHash } from "../../src/cache/content-hash.js";

describe("contentHash", () => {
  it("returns a 24-character base64url string", () => {
    const h = contentHash("hello world");
    expect(h).toHaveLength(24);
    // base64url alphabet: A-Z, a-z, 0-9, -, _ (no /, +, or =)
    expect(h).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it("is deterministic", () => {
    expect(contentHash("hello")).toBe(contentHash("hello"));
  });

  it("differs for different inputs (collision-resistant smoke check)", () => {
    expect(contentHash("hello")).not.toBe(contentHash("world"));
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });

  it("treats Buffer and equivalent string identically", () => {
    const fromString = contentHash("the quick brown fox");
    const fromBuffer = contentHash(Buffer.from("the quick brown fox", "utf-8"));
    expect(fromString).toBe(fromBuffer);
  });

  it("differs by a single byte change", () => {
    const a = contentHash("workspace: foo\n");
    const b = contentHash("workspace: bar\n");
    expect(a).not.toBe(b);
  });

  it("handles empty input", () => {
    const h = contentHash("");
    expect(h).toHaveLength(24);
    expect(h).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });
});
