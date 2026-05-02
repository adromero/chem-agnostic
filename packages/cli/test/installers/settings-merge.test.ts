// ---------------------------------------------------------------------------
// Unit tests for the JSON-merge utility used by all install-hooks installers.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  hasChemagHooks,
  mergeChemagHooks,
  removeChemagHooks,
  serializeSettings,
  type ChemagHookSpec,
  type ClaudeSettings,
} from "../../src/installers/_settings-merge.js";

const HOOK_SPECS: ChemagHookSpec[] = [
  {
    event: "PreToolUse",
    matcher: "Edit|Write",
    command: "chemag check-edit --for-hook claude",
  },
  {
    event: "PostToolUse",
    matcher: "Edit|Write",
    command: "chemag analyze --for-hook claude",
  },
];

describe("mergeChemagHooks — empty start", () => {
  it("creates hooks map and matcher blocks when none exist", () => {
    const merged = mergeChemagHooks(null, HOOK_SPECS);
    expect(merged.hooks).toBeDefined();
    expect(merged.hooks?.PreToolUse).toBeDefined();
    expect(merged.hooks?.PreToolUse.length).toBe(1);
    expect(merged.hooks?.PreToolUse[0].matcher).toBe("Edit|Write");
    expect(merged.hooks?.PreToolUse[0].hooks[0]._chemag).toBe(true);
    expect(merged.hooks?.PreToolUse[0].hooks[0].command).toContain("check-edit");
  });
});

describe("mergeChemagHooks — idempotence", () => {
  it("re-merging the same specs produces deep-equal output", () => {
    const a = mergeChemagHooks(null, HOOK_SPECS);
    const b = mergeChemagHooks(a, HOOK_SPECS);
    expect(serializeSettings(a)).toBe(serializeSettings(b));
  });
});

describe("mergeChemagHooks — coexistence", () => {
  it("preserves a non-chemag hook entry under the same matcher", () => {
    const existing: ClaudeSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [{ type: "command", command: "/usr/local/bin/safety-net.sh" }],
          },
        ],
      },
    };
    const merged = mergeChemagHooks(existing, HOOK_SPECS);

    // Bash matcher block untouched
    const bash = merged.hooks?.PreToolUse.find((b) => b.matcher === "Bash");
    expect(bash).toBeDefined();
    expect(bash?.hooks.length).toBe(1);
    expect(bash?.hooks[0]._chemag).toBeUndefined();

    // chemag matcher block added alongside it
    const ew = merged.hooks?.PreToolUse.find((b) => b.matcher === "Edit|Write");
    expect(ew).toBeDefined();
    expect(ew?.hooks[0]._chemag).toBe(true);
  });

  it("appends chemag entry in an existing matcher block instead of replacing", () => {
    const existing: ClaudeSettings = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [{ type: "command", command: "echo upstream-owned" }],
          },
        ],
      },
    };
    const merged = mergeChemagHooks(existing, HOOK_SPECS);
    const ew = merged.hooks?.PreToolUse.find((b) => b.matcher === "Edit|Write");
    expect(ew?.hooks.length).toBe(2);
    // Upstream entry stays first; chemag appended.
    expect(ew?.hooks[0]._chemag).toBeUndefined();
    expect(ew?.hooks[0].command).toBe("echo upstream-owned");
    expect(ew?.hooks[1]._chemag).toBe(true);
  });
});

describe("removeChemagHooks", () => {
  it("removes only chemag-tagged entries; non-chemag entries stay", () => {
    const merged = mergeChemagHooks(
      {
        hooks: {
          PreToolUse: [
            {
              matcher: "Bash",
              hooks: [{ type: "command", command: "/usr/local/bin/safety.sh" }],
            },
          ],
        },
      },
      HOOK_SPECS,
    );

    const stripped = removeChemagHooks(merged);
    // Bash matcher still present, untouched.
    const bash = stripped.hooks?.PreToolUse.find((b) => b.matcher === "Bash");
    expect(bash).toBeDefined();
    expect(bash?.hooks.length).toBe(1);
    expect(bash?.hooks[0]._chemag).toBeUndefined();

    // Edit|Write matcher block was chemag-only — removed entirely.
    const ew = stripped.hooks?.PreToolUse.find((b) => b.matcher === "Edit|Write");
    expect(ew).toBeUndefined();
  });

  it("removes empty `hooks` map entirely when nothing remains", () => {
    const merged = mergeChemagHooks(null, HOOK_SPECS);
    const stripped = removeChemagHooks(merged);
    expect(stripped.hooks).toBeUndefined();
  });

  it("traceless round-trip: install → uninstall produces a clean object", () => {
    const original: ClaudeSettings = { someUnrelatedKey: "value" };
    const installed = mergeChemagHooks(original, HOOK_SPECS);
    const uninstalled = removeChemagHooks(installed);
    expect(serializeSettings(uninstalled)).toBe(serializeSettings(original));
  });
});

describe("hasChemagHooks", () => {
  it("false for empty / non-chemag-only settings", () => {
    expect(hasChemagHooks(null)).toBe(false);
    expect(hasChemagHooks({})).toBe(false);
    expect(
      hasChemagHooks({
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
        },
      }),
    ).toBe(false);
  });

  it("true after merging chemag specs", () => {
    expect(hasChemagHooks(mergeChemagHooks(null, HOOK_SPECS))).toBe(true);
  });
});
