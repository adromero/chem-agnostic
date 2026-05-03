# Track 0 — Foundations (WP-001 through WP-008)

Track 0 is prerequisite for all other tracks. The conductor must complete Track 0 before opening parallel tracks.

## Sequencing within track

```
WP-001 ─→ WP-002 ─→ WP-003 ─→ WP-004 ─→ WP-005
   ↓                                     ↓
WP-007 ────────────────────────→ WP-006 ─┴─→ WP-008
```

WP-001 is gated. After WP-001, WP-002 and WP-007 can run in parallel. WP-003 unblocks WP-004. WP-005 finalizes diagnostic plumbing for downstream tracks.

---

## WP-001 — Monorepo conversion + project prerequisites

**Track:** 0
**Effort:** L
**Depends on:** none
**Blocks:** all subsequent WPs

### Description

Convert the current single-package repo into a pnpm + Turborepo monorepo per the structure in `01-repository-structure.md`. Set up tooling baseline. Document external prerequisites that the operator (not the conductor) must complete.

### Files to create

- `pnpm-workspace.yaml`
- `turbo.json`
- `tsconfig.base.json`
- `biome.json`
- `.changeset/config.json`
- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`
- `.nvmrc` (`22`)
- `.npmrc` (workspace-prefer-workspace-packages, hoist-pattern, etc.)
- `docs/adrs/0001-monorepo-toolchain.md`
- `docs/master-plan/STATUS.md` (live tracking of WP completion)
- `docs/master-plan/PREREQUISITES.md` (operator-required external setup)
- `scripts/check-prereqs.ts` (fails build if env not provisioned)
- Root `package.json` with workspace scripts and Turborepo config

### Files to move (no behavior changes)

- `src/*` → `packages/cli/src/`, splitting CLI commands into `packages/cli/src/commands/` per the target structure
- `src/{types,plugin-interface,checks,import-check,loader,graph,scaffold,sync,template-claude-md}.ts` → `packages/core/src/`
- `plugins/typescript/*` → `packages/plugin-typescript/src/`
- `plugins/python/*` → `packages/plugin-python/src/`
- `plugins/python/parse_imports.py` stays inside `packages/plugin-python/python/parse_imports.py`
- `test/*` → mirror under each package's `test/`

### Files to modify

- All TypeScript imports re-pathed to package boundaries (`@chemag/core/types` etc.).
- `package.json` per package, declaring the public name.
- Root `package.json` becomes private workspace root.

### Tooling setup

- Biome replaces any ad-hoc Prettier / ESLint config.
- Turborepo pipeline: `lint`, `typecheck`, `test`, `build`, `docs:codegen`. Each declares `dependsOn`. Outputs cached.
- Changesets initialized; `.changeset/README.md` documents the workflow.

### Renames

- Public binary: `chemag` (with `chem-ag` retained as alias). Update `bin` field in `packages/cli/package.json`.
- Update README, all examples in CLAUDE.md, and any blog drafts to use `chemag`.

### PREREQUISITES.md content

The operator must, before WP-029 ships, provision:

1. Domain `chemag.dev` (Cloudflare DNS).
2. Domain `chemag.cloud` (Cloudflare DNS).
3. GitHub org `chemag-org` (Pro tier, free for OSS).
4. npm org `chemag` (Free tier).
5. Stripe account (US entity preferred for ACH).
6. Clerk org for authentication.
7. Cloudflare account with R2 bucket for artifacts.
8. Fly.io account.
9. Vercel account linked to GitHub org.
10. Sentry org.
11. PostHog org (cloud or self-hosted).
12. Resend account (for email).
13. Discord server with admin bot configured.

`scripts/check-prereqs.ts` reads `.env` and verifies each entry has a corresponding API key or domain. This script is run before deploys but does NOT block CLI/engine WPs.

### Tests

- `scripts/check-prereqs.test.ts` covers each missing-key case.
- All existing tests must continue passing after the move (208 tests).
- New: `test/monorepo/structure.test.ts` asserts the workspace layout matches the spec (catches accidental package moves).

### Acceptance criteria

- [ ] `pnpm install` succeeds from a clean clone on Node 22 + pnpm 9.
- [ ] `pnpm turbo build` produces every package's dist.
- [ ] `pnpm turbo test` runs all 208 existing tests, plus new monorepo structure tests, with zero failures.
- [ ] `chemag --version` works after `pnpm link --global` in `packages/cli`.
- [ ] `chem-ag --version` (alias) also works.
- [ ] Biome runs on the whole workspace with zero violations.
- [ ] CI workflow passes on the monorepo conversion PR.
- [ ] `STATUS.md` exists with a checklist for all 60 WPs (WP-001 marked done).
- [ ] `PREREQUISITES.md` enumerates all external accounts.
- [ ] No git history of files that moved is lost (use `git mv` or follow-rename merges).

---

## WP-002 — Vocabulary system

**Track:** 0
**Effort:** M
**Depends on:** WP-001
**Blocks:** WP-008, all WPs producing user-facing text

### Description

Implement an i18n-style key-based vocabulary system in `@chemag/core`. All user-facing strings — errors, help text, generated CLAUDE.md/AGENTS.md content, scaffold templates — flow through `tr(key, params)`. Two locales ship: `standard` (default) and `chemistry`.

### Files to create

- `packages/core/src/vocabulary/index.ts` — public API: `tr(key, params?)`, `setVocabulary(name)`, `getVocabulary()`.
- `packages/core/src/vocabulary/keys.ts` — typed keys (no string typos at compile time).
- `packages/core/src/vocabulary/standard.json`
- `packages/core/src/vocabulary/chemistry.json`
- `packages/core/test/vocabulary.test.ts`
- `packages/core/test/vocabulary.snapshot.test.ts` — verifies all keys are translated in both locales.

### Files to modify

- Every file in `packages/cli/src/commands/` that prints user text — switch literals to `tr()` calls.
- `packages/core/src/checks.ts` diagnostic messages — `tr()`.
- `packages/core/src/import-check.ts` diagnostic messages — `tr()`.
- `packages/core/src/template-claude-md.ts` — accept a vocabulary param; emit either flavor.
- `packages/plugin-typescript/src/index.ts` and `packages/plugin-python/src/index.ts` `generateClaudeMd` methods — `tr()`-aware.

### API design

```ts
export type VocabularyName = "standard" | "chemistry";

// Translation key registry — exhaustive, compile-time-checked
export type TrKey =
  | "role.element" | "role.molecule" | "role.reaction"
  | "role.interface" | "role.adapter" | "role.buffer"
  | "container.compound" | "container.reagent" | "container.solvent" | "container.catalyst"
  | "concept.bond" | "concept.unit" | "concept.signal" | "concept.assay"
  | "diagnostic.bond_violation"     // params: { src_role, target_role, allowed[] }
  | "diagnostic.import_bypass"      // params: { compound, surface }
  | "diagnostic.import_undeclared"  // params: { compound }
  | "diagnostic.unknown_role"       // params: { role, known[] }
  | "diagnostic.duplicate_compound" // params: { name, other }
  | ... (all 15 check messages)
  | "cli.help.intro"
  | "cli.help.usage"
  | "cli.help.commands"
  | ... (one per command)
  | "claude_md.intro"
  | "claude_md.roles_table"
  | "claude_md.bonds_table"
  | "claude_md.compound_types"
  | "claude_md.workflow"
  | "claude_md.tool_reference"
  | "claude_md.ai_rules";

export function tr(key: TrKey, params?: Record<string, unknown>): string;
export function setVocabulary(name: VocabularyName): void;
export function getVocabulary(): VocabularyName;
```

### JSON layout

```json
// standard.json
{
  "role.element": "value-object",
  "role.molecule": "entity",
  "role.reaction": "use-case",
  "role.interface": "port",
  "role.adapter": "adapter",
  "role.buffer": "middleware",
  "container.compound": "module",
  "container.reagent": "shared-kernel",
  "container.solvent": "infrastructure",
  "container.catalyst": "composition-root",
  "concept.bond": "dependency rule",
  "diagnostic.bond_violation": "{src_role} \"{src_name}\" depends on {target_role} \"{target_name}\" — dependency rule violation; {src_role} may only depend on [{allowed}]",
  ...
}

// chemistry.json
{
  "role.element": "element",
  "role.molecule": "molecule",
  "role.reaction": "reaction",
  ...
  "diagnostic.bond_violation": "{src_name} ({src_role}) depends on {target_name} ({target_role}) — bond violation; {src_role} can only bond with [{allowed}]",
  ...
}
```

### Configuration sources, in precedence order

1. CLI flag: `--vocabulary <standard|chemistry>`
2. Environment variable: `CHEMAG_VOCABULARY`
3. `workspace.yaml` field: `vocabulary: standard`
4. Default: `standard`

The vocabulary is resolved once at CLI entry (`packages/cli/src/cli.ts`) and stored module-locally. MCP server reads from request context per-session (a session sets vocabulary at initialize time).

### Tests

- All keys in `keys.ts` exist in both JSON files (`vocabulary.snapshot.test.ts` enforces).
- `tr()` returns the correct string for each key in each locale.
- Param interpolation works for all keys with parameters.
- Missing key returns the key itself wrapped in `[!key]` and logs a warning (does not throw).
- `setVocabulary` switches mid-process.
- Precedence: flag > env > workspace > default.

### Acceptance criteria

- [ ] No literal user-facing string remains in `packages/cli/src/commands/` or `packages/core/src/{checks,import-check,template-claude-md}.ts`.
- [ ] Both vocabularies render the full `chemag init` workflow without missing keys.
- [ ] Snapshot tests for both vocabularies committed.
- [ ] `chemag check --vocabulary chemistry workspace.yaml` produces chemistry-vocabulary errors against the test fixture.
- [ ] `CHEMAG_VOCABULARY=chemistry chemag check workspace.yaml` does the same.
- [ ] Adding a new key without a translation causes a CI failure.

---

## WP-003 — Manifest cache layer

**Track:** 0
**Effort:** M
**Depends on:** WP-001
**Blocks:** WP-004, performance-sensitive WPs

### Description

Add a content-addressed cache for parsed manifests, the workspace, and per-file imports. Used by `check-edit` for sub-100ms single-file checks and by `analyze` to skip unchanged files.

### Files to create

- `packages/cli/src/cache/manifest-cache.ts`
- `packages/cli/src/cache/import-cache.ts`
- `packages/cli/src/cache/content-hash.ts`
- `packages/cli/src/cache/cache-dir.ts` — resolves `.chemag/cache/` (gitignored by default).
- `packages/cli/test/cache/*.test.ts`

### API design

```ts
export interface ManifestCache {
  // Returns cached parse result if file hash matches, else parses and caches.
  loadWorkspace(workspacePath: string): Workspace;
  loadCompound(compoundDir: string): LoadedCompound;
  loadAllCompounds(workspace: Workspace): LoadedCompound[];

  // Invalidate everything; called on workspace.yaml change.
  invalidateAll(): void;

  // Stats for telemetry / debugging.
  stats(): { hits: number; misses: number; size: number };
}

export interface ImportCache {
  // Cached imports for a file, indexed by file content hash.
  getImports(filePath: string, contentHash: string): ParsedImport[] | null;
  setImports(filePath: string, contentHash: string, imports: ParsedImport[]): void;
}

export function contentHash(content: string): string; // sha256, base64url, first 24 chars
```

### Cache layout on disk

```
.chemag/cache/
├── version                    # cache schema version, "1"
├── manifests/
│   └── <sha-of-workspace-yaml-path>/
│       ├── workspace.json     # { hash, parsed }
│       └── compounds/
│           └── <name>.json    # { hash, parsed }
├── imports/
│   └── <ext-stripped-hash>/<content-hash>.json
└── locks/                     # PID-based lockfiles for cross-process coherence
```

### Concurrency

- Cache reads and writes use file-level locks via `proper-lockfile` to handle parallel CLI invocations (rare but possible in monorepo CI).
- Atomic write via `fs.writeFile` to a `.tmp` then `rename`.
- Stale lock detection: if a lock is >30s old, override.

### Invalidation

- Workspace cache invalidates when `workspace.yaml` content hash changes.
- Compound cache invalidates when its `compound.yaml` hash changes.
- Import cache is content-addressed by file SHA — no time-based invalidation needed.

### Tests

- Round-trip: write → read returns identical data.
- Hash mismatch → re-parses.
- Schema version mismatch → invalidates whole cache.
- Concurrent writes don't corrupt files.
- Cache dir creation works on first run.

### Acceptance criteria

- [ ] Second `chemag check` on unchanged tree completes in <300ms on the reference monorepo.
- [ ] Editing one compound only re-parses that compound.
- [ ] `.chemag/cache/` is added to default `.gitignore` by `chemag init`.
- [ ] `CHEMAG_CACHE_DIR` env var overrides default location.
- [ ] `--no-cache` flag bypasses cache entirely.
- [ ] Cache survives process crashes mid-write (no half-written files break subsequent runs).

---

## WP-004 — `check-edit` subcommand

**Track:** 0
**Effort:** M
**Depends on:** WP-001, WP-003
**Blocks:** WP-010 (Claude Code hooks), WP-014 (MCP)

### Description

A fast single-file checker invoked by AI agent hooks before/after an edit. Returns violations in <100ms by leveraging the cache (WP-003) and avoiding a full workspace scan.

### Files to create

- `packages/cli/src/commands/check-edit.ts`
- `packages/core/src/check-edit.ts` — the engine, separate from CLI.
- `packages/cli/test/commands/check-edit.test.ts`
- `packages/core/test/check-edit.test.ts`

### CLI surface

```
chemag check-edit <file> [--content <string-or-stdin>] [--workspace <path>] [--format json|human]
                  [--proposed-role <role>] [--proposed-compound <name>]

Examples:
  chemag check-edit src/compounds/orders/reactions/createOrder.ts
      → analyzes the file at that path on disk

  cat new-content.ts | chemag check-edit src/compounds/orders/reactions/createOrder.ts --content -
      → analyzes hypothetical new content (the agent hasn't written yet)

  chemag check-edit src/compounds/orders/new-file.ts --content - \
      --proposed-role reaction --proposed-compound orders
      → analyzes a file that doesn't exist yet, with proposed placement
```

### Behavior

1. Resolve workspace (auto-discover `workspace.yaml` upward unless `--workspace`).
2. Load workspace + compound from cache (WP-003).
3. Determine the *target compound* and *role* of the file:
   - If file exists in workspace: from manifest.
   - If `--proposed-role` and `--proposed-compound`: as specified.
   - Else: infer from path (using existing logic in `inferUnits`).
   - If still unresolvable: return diagnostic `unresolvable_placement`.
4. Parse imports of the new content via the language plugin.
5. Run two checks against this file only:
   - **Bond rules:** does this role import a forbidden role?
   - **Cross-compound rules:** is the target a public surface? declared import?
6. Run a third check: **role-folder mismatch** — does the file path's role folder match the proposed/declared role?
7. Output diagnostics (JSON or human, per `--format`).
8. Exit code: `0` if no diagnostics, `1` if errors, `2` on engine failure.

### Performance budget

- Cold (no cache): <500ms.
- Warm (cache populated): <100ms.
- Measured by a vitest benchmark in `packages/cli/test/perf/check-edit.bench.ts`.

### JSON output schema

```json
{
  "file": "src/compounds/orders/reactions/createOrder.ts",
  "compound": "orders",
  "role": "reaction",
  "diagnostics": [
    {
      "level": "error",
      "code": "BOND_VIOLATION",
      "message": "reaction \"createOrder\" imports adapter \"PgOrderRepo\" — dependency rule violation",
      "hint": "reaction may only depend on [element, molecule, interface]",
      "line": 4,
      "column": 1,
      "imported_module": "../adapters/PgOrderRepo",
      "imported_role": "adapter",
      "remediation": {
        "kind": "use_interface",
        "interface_candidates": ["OrderRepo"]
      }
    }
  ]
}
```

The `remediation` block is optional structured guidance for an AI agent. Possible kinds:

- `use_interface`: list interfaces the offending adapter implements.
- `move_to_compound`: suggest correct compound based on existing units of that role.
- `move_to_role_folder`: file is in wrong folder for declared role.
- `import_via_public_surface`: the cross-compound import bypass case.
- `add_compound_import`: target compound exists but isn't declared in source's imports list.

### Tests

- Test fixtures for each diagnostic kind.
- Stdin content path.
- Proposed-placement path (file doesn't exist).
- Workspace auto-discovery.
- Cache hit produces identical result to cache miss.
- `--format json` schema is validated by a JSON Schema test.
- Performance budget enforced in CI (perf.bench.ts).

### Acceptance criteria

- [ ] All 5 diagnostic kinds detected on hand-crafted fixtures.
- [ ] Performance budget met in CI (warm path <100ms).
- [ ] Stdin content correctly analyzed without writing to disk.
- [ ] JSON output validates against a published schema in `packages/core/schemas/check-edit-result.schema.json`.
- [ ] Help text written and snapshot-tested.

---

## WP-005 — Output formats: JSON, SARIF, JUnit

**Track:** 0
**Effort:** M
**Depends on:** WP-001, WP-007
**Blocks:** WP-023 (GitHub Action), WP-024 (GitLab CI)

### Description

Add `--format json|sarif|junit|human` to `check`, `analyze`, and `check-edit`. Required for CI integrations and downstream tooling.

### Files to create

- `packages/cli/src/format/human.ts` (extract existing colored output from `cmd-check.ts` / `cmd-analyze.ts`)
- `packages/cli/src/format/json.ts`
- `packages/cli/src/format/sarif.ts` — SARIF 2.1.0
- `packages/cli/src/format/junit.ts`
- `packages/cli/src/format/index.ts` — dispatcher with `formatDiagnostics(diagnostics, format, context)`
- `packages/core/schemas/diagnostics.schema.json` — JSON Schema for the JSON format
- Tests for each formatter against fixture diagnostics.

### Files to modify

- `packages/cli/src/commands/check.ts`, `analyze.ts`, `check-edit.ts`: accept `--format`, dispatch through formatter.

### SARIF specifics

- Generate one `Run` per `chemag` invocation.
- `tool.driver.name`: `chemag`.
- `tool.driver.version`: from `packages/cli/package.json`.
- `tool.driver.rules`: derived from the diagnostic code registry (WP-007). Each rule has `id`, `name`, `shortDescription`, `helpUri` pointing to docs site.
- Each diagnostic becomes a `result` with `ruleId`, `level`, `message`, `locations[].physicalLocation`.
- Validates against the SARIF JSON Schema in CI.

### JUnit specifics

- One `<testsuite>` per workspace, one `<testcase>` per compound.
- A compound with no diagnostics: passing `<testcase>`.
- A compound with diagnostics: failing `<testcase>` with `<failure>` containing rendered diagnostic text.
- For `check-edit`, single `<testcase>` per file.

### Tests

- Round-trip: parse the produced output, ensure no data loss vs internal Diagnostic[].
- SARIF validates against JSON Schema.
- JUnit validates against XSD.
- Human format snapshot tests for both vocabularies.

### Acceptance criteria

- [ ] `chemag check --format sarif` produces a valid SARIF 2.1.0 file.
- [ ] `chemag analyze --format junit` produces a CI-compatible JUnit XML.
- [ ] `chemag check --format json` validates against the published JSON Schema.
- [ ] Human format remains the default; behavior unchanged for existing users.
- [ ] CI tests every format on a fixture with at least one diagnostic of every kind.

---

## WP-006 — Telemetry library (opt-in)

**Track:** 0
**Effort:** M
**Depends on:** WP-001
**Blocks:** WP-008, post-launch growth metrics

### Description

A privacy-first opt-in telemetry library used by the CLI, MCP server, and VS Code extension. Records event types listed in `09-cross-cutting.md`. Defaults to OFF; first run prompts the user.

### Files to create

- `packages/telemetry/src/index.ts`
- `packages/telemetry/src/transport.ts` — POST to PostHog with retry/backoff and 5s timeout.
- `packages/telemetry/src/consent.ts` — read/write `~/.config/chemag/config.json`.
- `packages/telemetry/src/anonymizer.ts` — strips PII per the schema.
- `packages/telemetry/src/queue.ts` — in-memory queue with bounded retries (3) and persistent fallback to a temp file.
- `packages/telemetry/test/*`

### Files to modify

- `packages/cli/src/cli.ts` — first-run consent prompt; flush queue on exit.
- `packages/cli/src/commands/*` — emit `cli.command.invoked` etc.
- `packages/cli/src/commands/check.ts`, `analyze.ts` — emit `cli.violations.found`.

### Configuration

- File: `~/.config/chemag/config.json`.
- Schema: `{ telemetry: { enabled: boolean, anonymousId: string, optedInAt?: string } }`.
- Anonymous ID is a UUID generated on first opt-in. No correlation to user identity.

### Consent prompt

On first invocation after WP-006 ships (detected by absence of config file), the CLI prints:

```
chem-ag → telemetry consent

Help us improve chem-ag by sharing anonymous usage data?
- What we send: command names, exit codes, durations, OS, version.
- What we DON'T send: file paths, code, project names, errors with messages.
- Privacy policy: https://chemag.dev/privacy
- You can change this any time: chemag config set telemetry.enabled <true|false>

Send anonymous usage telemetry? [y/N]:
```

If the user is non-interactive (no TTY), telemetry stays OFF, no prompt. The CLI prints a one-line note "(telemetry off — run `chemag config telemetry on` to enable)" and continues.

### Endpoint

- PostHog Cloud (US instance for v1.0).
- HTTPS only.
- Public PostHog project key embedded in the package; only allows event ingestion, no read API.

### Tests

- Consent OFF → no network calls (mock fetch verifies).
- Consent ON → events queue and flush.
- Network failure → events persist to disk and retry on next run (capped at 1MB queue).
- `chemag config get/set telemetry.enabled` works.
- Anonymizer strips file paths from any payload.

### Acceptance criteria

- [ ] No network call when telemetry is off (verified by network-recording test).
- [ ] First-run prompt visible interactively, silent non-interactively.
- [ ] Events visible in PostHog when opted in (manual verification by operator).
- [ ] Documented in docs site `/docs/telemetry`.
- [ ] Privacy policy reflects telemetry behavior.
- [ ] `--no-telemetry` global CLI flag forces off for one invocation.

---

## WP-007 — Error code system + diagnostic taxonomy

**Track:** 0
**Effort:** S
**Depends on:** WP-001
**Blocks:** WP-005

### Description

Establish a taxonomy of diagnostic codes shared by all checks. Each diagnostic has a stable code (e.g. `CHEM-BOND-001`) referenced in tests, docs, and SARIF rule descriptors.

### Files to create

- `packages/core/src/diagnostics/codes.ts` — code registry.
- `packages/core/src/diagnostics/registry-test.ts` — verifies stability (codes never reused, never deleted without deprecation).
- `docs/adrs/0002-diagnostic-codes.md`
- `apps/docs-site/src/content/docs/cli-reference/diagnostics.md` — auto-generated index of codes.

### Files to modify

- `packages/core/src/checks.ts` — every diagnostic `push` includes a `code`.
- `packages/core/src/import-check.ts` — same.
- `packages/core/src/types.ts` — add `code: DiagnosticCode` to `Diagnostic`.

### Code naming

- Format: `CHEM-<CATEGORY>-<NNN>`.
- Categories: `MANIFEST`, `BOND`, `IMPORT`, `EXPORT`, `WIRING`, `SIGNAL`, `ASSAY`, `TYPE`, `PUBLIC`, `ROLE`, `PLACEMENT`.
- E.g.: `CHEM-BOND-001` = generic bond rule violation. `CHEM-IMPORT-002` = import bypasses public surface.

### Registry shape

```ts
export interface DiagnosticCodeMeta {
  code: DiagnosticCode;
  category: "MANIFEST" | "BOND" | "IMPORT" | ...;
  level: "error" | "warning";
  trKey: TrKey;
  helpFragment: string; // section anchor in docs
  // Stability: codes can be deprecated (level set to "warning" with deprecation message)
  // but never removed in v1.x.
  deprecated?: { since: string; replacement?: DiagnosticCode };
}

export const DIAGNOSTIC_CODES: Record<DiagnosticCode, DiagnosticCodeMeta>;
```

### Tests

- Every diagnostic emitted by tests has a code in the registry.
- Snapshot of the registry to detect accidental removals.
- Deprecation flow: a deprecated code still works but emits a warning when surfaced via `chemag check --explain CHEM-XXX-NNN`.

### Acceptance criteria

- [ ] All 15 existing checks have stable codes.
- [ ] Adding a check without a code fails CI.
- [ ] `chemag check --explain CHEM-BOND-001` prints the description, level, and a doc link.
- [ ] SARIF output uses these codes as `ruleId`.

---

## WP-008 — CLI ergonomics overhaul

**Track:** 0
**Effort:** M
**Depends on:** WP-002, WP-006, WP-007
**Blocks:** GTM polish

### Description

Replace the hand-rolled argv parsing in `packages/cli/src/cli.ts` with a structured CLI framework. Standardize colors, add progress indicators, improve help output, support shell completions.

### Choice of framework

**citty** (or **commander** if citty proves immature) — minimal, ESM-native, supports subcommands, decent help output. Final choice via ADR `docs/adrs/0003-cli-framework.md`.

### Files to create

- `packages/cli/src/cli.ts` — rewritten with the framework.
- `packages/cli/src/ui/spinner.ts`
- `packages/cli/src/ui/colors.ts` — wraps `picocolors`.
- `packages/cli/src/ui/box.ts` — boxen-style output.
- `packages/cli/src/completions/` — bash, zsh, fish completion scripts.

### Files to modify

- All `packages/cli/src/commands/*.ts` — switch to framework's command definitions.

### Features

- `chemag --help` prints a structured help with command groups (Workspace / Validation / Generation / AI / Cloud).
- `chemag completion <shell>` prints a completion script.
- `chemag --version` prints version.
- `chemag config <get|set|unset> <key> [value]` for config (telemetry, vocabulary, cache dir).
- Spinner during long ops (parsing, network calls). Auto-disabled in non-TTY.
- Color auto-disabled in non-TTY or with `NO_COLOR`.
- Errors print with file:line refs where applicable, indented hints.

### Tests

- Help output snapshot per command, both vocabularies.
- Completion scripts shell-tested in CI on bash 5 and zsh.
- `NO_COLOR=1` strips ANSI from output.
- `--quiet` suppresses spinners and informational output (only diagnostics).

### Acceptance criteria

- [ ] Help text is consistent across all commands.
- [ ] Completion scripts pass shell linters and produce sensible completions.
- [ ] Spinner/progress appears for ops >500ms only.
- [ ] `--json` is a global alias for `--format json` on every command that supports it.
- [ ] Existing tests continue to pass after the rewrite.
