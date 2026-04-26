// Anonymizer tests — string scrubbing and recursive object scrubbing.

import { describe, expect, it } from "vitest";
import { anonymize, scrubString } from "../src/anonymizer.js";

describe("scrubString", () => {
  it("redacts an absolute POSIX path", () => {
    expect(scrubString("/home/user/project/file.ts")).toBe("<redacted-path>");
  });

  it("redacts a Windows drive-letter path", () => {
    expect(scrubString("C:\\Users\\me\\file.ts")).toBe("<redacted-path>");
  });

  it("redacts a ~/ home path", () => {
    expect(scrubString("~/projects/foo.py")).toBe("<redacted-path>");
  });

  it("redacts a ./ relative path", () => {
    expect(scrubString("./src/foo.ts")).toBe("<redacted-path>");
  });

  it("redacts an embedded path inside a longer string", () => {
    expect(scrubString("loaded /home/user/foo.ts during init")).toContain("<redacted-path>");
    expect(scrubString("loaded /home/user/foo.ts during init")).not.toContain("/home/user");
  });

  it("redacts an email", () => {
    expect(scrubString("alice@example.com")).toBe("<redacted-email>");
  });

  it("redacts an https URL", () => {
    expect(scrubString("https://chemag.dev/privacy")).toBe("<redacted-url>");
  });

  it("redacts a file:// URL", () => {
    expect(scrubString("file:///home/x/y.ts")).toBe("<redacted-url>");
  });

  it("leaves non-path strings alone", () => {
    expect(scrubString("check")).toBe("check");
    expect(scrubString("standard")).toBe("standard");
    expect(scrubString("v0.1.0")).toBe("v0.1.0");
  });
});

describe("anonymize — recursive", () => {
  it("strips DENY_KEYS at any depth", () => {
    const input = {
      command: "check",
      message: "some error with /home/foo.ts",
      nested: { stack: "trace at /home/foo.ts:1:2", ok: true },
    };
    const out = anonymize(input);
    expect(out).toEqual({ command: "check", nested: { ok: true } });
  });

  it("scrubs path strings inside arrays", () => {
    const input = ["check", "/home/x/foo.ts", "ok"];
    const out = anonymize(input);
    expect(out).toEqual(["check", "<redacted-path>", "ok"]);
  });

  it("preserves numbers and booleans", () => {
    const input = { count: 5, ok: true, ratio: 1.5 };
    expect(anonymize(input)).toEqual(input);
  });

  it("handles null and undefined", () => {
    expect(anonymize(null)).toBeNull();
    expect(anonymize(undefined)).toBeUndefined();
  });
});

// Property-style: build random payloads that include path-shaped strings and
// assert that no redacted-path string appears in the OUTPUT.
describe("anonymize — property invariant", () => {
  function generatePathLikeStrings(): string[] {
    return [
      "/etc/passwd",
      "/usr/local/lib/foo.so",
      "C:\\Windows\\System32\\foo.dll",
      "~/.ssh/id_rsa",
      "./relative/file.txt",
      "../parent/file.go",
      "/home/user/project/src/index.ts",
    ];
  }

  function generateSafeStrings(): string[] {
    return ["check", "analyze", "darwin", "linux", "v22.0.0", "0.1.0", "BOND", "PLACEMENT"];
  }

  it("absolute paths NEVER survive scrubbing in any field", () => {
    const paths = generatePathLikeStrings();
    const safe = generateSafeStrings();
    for (const p of paths) {
      for (const s of safe) {
        const payload = {
          command: s,
          extra: p,
          nested: { deeper: { value: p } },
          list: [s, p, s],
        };
        const out = JSON.stringify(anonymize(payload));
        expect(out).not.toContain(p);
        expect(out).toContain("<redacted-");
      }
    }
  });

  it("DENY_KEYS are stripped even when the value is plain text", () => {
    const payload = { command: "check", message: "ok", path: "ok" };
    const out = anonymize(payload) as Record<string, unknown>;
    expect(out.message).toBeUndefined();
    expect(out.path).toBeUndefined();
    expect(out.command).toBe("check");
  });
});
