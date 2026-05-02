// ---------------------------------------------------------------------------
// Generic JSON-settings merge utility shared by the install-hooks installers
// (Claude Code today; Cursor/Codex/Aider/Cline/Copilot in WP-011..WP-013).
//
// Each chemag-installed entry is tagged `_chemag: true` so an `--uninstall`
// run can remove only chemag entries without touching upstream-owned hooks.
// We assume the host parser tolerates unknown keys; if any host ever rejects
// them, this module can move the tag to a sidecar file without changing the
// CLI surface (see ADR-0004).
//
// All operations are pure (input → output) — disk I/O lives in the caller.
// ---------------------------------------------------------------------------

/** A single hook entry recorded under one matcher block. */
export interface HookEntry {
  type: "command";
  command: string;
  /** Tag: chemag-installed entries set this to true. */
  _chemag?: boolean;
  /** Free-form metadata (timeout, etc.) that the host may forward to runtime. */
  [key: string]: unknown;
}

/** A matcher block as Claude Code stores it under hooks[<event>][matcher]. */
export interface MatcherBlock {
  matcher: string;
  hooks: HookEntry[];
}

/** Claude Code's settings.json shape (subset we touch). */
export interface ClaudeSettings {
  hooks?: Record<string, MatcherBlock[]>;
  [key: string]: unknown;
}

/** Description of a chemag entry to merge into a target settings file. */
export interface ChemagHookSpec {
  /** Hook event name, e.g. "PreToolUse" / "PostToolUse". */
  event: string;
  /** Matcher string (e.g. "Edit|Write"). */
  matcher: string;
  /** Command line to run. */
  command: string;
}

/**
 * Merge `chemagHooks` into `existing`, preserving non-chemag entries.
 *
 * Behavior:
 *   - For each chemag entry, look for an existing matcher block under the
 *     same event with the same matcher string. If found, append/replace the
 *     chemag entry within it (entries with the same command are deduped on
 *     the chemag side; non-chemag entries are never touched).
 *   - If no matcher block exists, create one.
 *   - Idempotent: merging a chemag spec that is already present produces
 *     deep-equal output.
 *
 * Returns a new settings object — does not mutate the input.
 */
export function mergeChemagHooks(
  existing: ClaudeSettings | null | undefined,
  chemagHooks: ChemagHookSpec[],
): ClaudeSettings {
  const out = clone((existing ?? {}) as ClaudeSettings);
  if (!out.hooks) out.hooks = {};
  const hooks: Record<string, MatcherBlock[]> = out.hooks;

  for (const spec of chemagHooks) {
    if (!hooks[spec.event]) hooks[spec.event] = [];
    const blocks: MatcherBlock[] = hooks[spec.event];

    let block: MatcherBlock | undefined = blocks.find((b) => b.matcher === spec.matcher);
    if (!block) {
      block = { matcher: spec.matcher, hooks: [] };
      blocks.push(block);
    }

    // Within the matcher block: replace any chemag entry that has the same
    // command (idempotence on re-install). Append otherwise. Non-chemag
    // entries are left untouched at their original positions.
    const idx = block.hooks.findIndex((h) => h._chemag === true && h.command === spec.command);
    const newEntry: HookEntry = {
      type: "command",
      command: spec.command,
      _chemag: true,
    };
    if (idx >= 0) {
      block.hooks[idx] = newEntry;
    } else {
      block.hooks.push(newEntry);
    }
  }

  return out;
}

/**
 * Remove every hook entry tagged `_chemag: true`. Drops empty matcher blocks
 * and (if the resulting `hooks` map is empty) removes the `hooks` key
 * entirely. Returns a new settings object — does not mutate the input.
 */
export function removeChemagHooks(existing: ClaudeSettings | null | undefined): ClaudeSettings {
  const out = clone((existing ?? {}) as ClaudeSettings);
  if (!out.hooks) return out;

  for (const event of Object.keys(out.hooks)) {
    const blocks = out.hooks[event];
    const filtered: MatcherBlock[] = [];
    for (const block of blocks) {
      const remainingHooks = block.hooks.filter((h) => h._chemag !== true);
      if (remainingHooks.length > 0) {
        filtered.push({ matcher: block.matcher, hooks: remainingHooks });
      }
    }
    if (filtered.length === 0) {
      delete out.hooks[event];
    } else {
      out.hooks[event] = filtered;
    }
  }

  if (Object.keys(out.hooks).length === 0) {
    delete out.hooks;
  }

  return out;
}

/**
 * True iff `existing` contains at least one chemag-tagged hook entry.
 * Used by uninstall to surface CHEM-INSTALL-HOOKS-005 when there's nothing
 * to remove.
 */
export function hasChemagHooks(existing: ClaudeSettings | null | undefined): boolean {
  if (!existing?.hooks) return false;
  for (const blocks of Object.values(existing.hooks)) {
    for (const block of blocks) {
      if (block.hooks.some((h) => h._chemag === true)) return true;
    }
  }
  return false;
}

/**
 * Stable serializer — JSON.stringify with 2-space indent and a trailing
 * newline. Used so install/re-install produces byte-identical output for the
 * idempotence test.
 */
export function serializeSettings(settings: ClaudeSettings): string {
  return `${JSON.stringify(settings, null, 2)}\n`;
}

function clone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}
