// ---------------------------------------------------------------------------
// Husky-aware helpers for installers that wire pre-commit hooks.
//
// Detection contract:
//   * `detectHusky(workspaceRoot)` returns true iff `husky` appears in the
//     project's `package.json` (any of `dependencies`, `devDependencies`, or
//     `peerDependencies`) OR a `.husky/` directory already exists at the
//     workspace root. Either signal is sufficient — we do not require both
//     because `pnpm husky init` creates `.husky/` without necessarily
//     pinning husky into `dependencies` until the next install pass.
//
// Tagging contract:
//   * Every chemag-managed line in `.husky/pre-commit` carries a
//     `# _chemag` trailing comment. `addChemagLine` and `removeChemagLines`
//     are the only writers — direct edits to `.husky/pre-commit` outside
//     this module are not supported.
//
// Failure surface:
//   * `PrecommitUnparseableError` is thrown when an existing
//     `.husky/pre-commit` cannot be safely parsed (binary content,
//     non-UTF-8, or a malformed prior chemag tag we cannot reliably remove).
//     `installCursor` translates that into CHEM-INSTALL-HOOKS-008.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";

/** The chemag tag suffix placed on every chemag-managed line. */
export const CHEMAG_TAG = "# _chemag";

/** The canonical pre-commit line the Cursor installer appends. */
export const CHEMAG_PRECOMMIT_LINE = `chemag check --format human || exit 1 ${CHEMAG_TAG}`;

/** Default shebang/body when chemag has to create `.husky/pre-commit` from scratch. */
const DEFAULT_HUSKY_HEADER = "#!/usr/bin/env sh\n";

/** Thrown when an existing `.husky/pre-commit` cannot be safely parsed/edited. */
export class PrecommitUnparseableError extends Error {
  readonly path: string;
  readonly reason: string;

  constructor(filePath: string, reason: string) {
    super(`.husky/pre-commit at ${filePath} is unparseable: ${reason}`);
    this.name = "PrecommitUnparseableError";
    this.path = filePath;
    this.reason = reason;
  }
}

export interface HuskyDetectResult {
  /** True if husky was detected via package.json or .husky/ directory. */
  detected: boolean;
  /** True if `.husky/` exists at workspaceRoot (regardless of package.json). */
  huskyDirExists: boolean;
  /** True if the dependency manifests reference husky. */
  dependencyDeclared: boolean;
  /** Absolute path to `.husky/pre-commit` (regardless of existence). */
  precommitPath: string;
}

/**
 * Detect whether husky is set up in the workspace. Returns a structured
 * result so callers can produce richer diagnostics.
 */
export function detectHusky(workspaceRoot: string): HuskyDetectResult {
  const huskyDir = path.join(workspaceRoot, ".husky");
  const huskyDirExists = fs.existsSync(huskyDir) && fs.statSync(huskyDir).isDirectory();

  const dependencyDeclared = packageJsonHasHusky(workspaceRoot);

  return {
    detected: huskyDirExists || dependencyDeclared,
    huskyDirExists,
    dependencyDeclared,
    precommitPath: path.join(huskyDir, "pre-commit"),
  };
}

function packageJsonHasHusky(workspaceRoot: string): boolean {
  const pkgPath = path.join(workspaceRoot, "package.json");
  if (!fs.existsSync(pkgPath)) return false;
  let raw: string;
  try {
    raw = fs.readFileSync(pkgPath, "utf-8");
  } catch {
    return false;
  }
  let pkg: {
    dependencies?: Record<string, unknown>;
    devDependencies?: Record<string, unknown>;
    peerDependencies?: Record<string, unknown>;
  };
  try {
    pkg = JSON.parse(raw);
  } catch {
    return false;
  }
  for (const bag of [pkg.dependencies, pkg.devDependencies, pkg.peerDependencies]) {
    if (bag && Object.prototype.hasOwnProperty.call(bag, "husky")) return true;
  }
  return false;
}

export interface AddChemagLineResult {
  /** Final body that should be written to `.husky/pre-commit`. */
  body: string;
  /** True if the body differs from `existing` (or `existing` was null). */
  changed: boolean;
  /** True if a chemag-tagged line already existed in the file. */
  alreadyPresent: boolean;
}

/**
 * Compute the post-merge body for `.husky/pre-commit`. Idempotent — if a
 * chemag-tagged line is already present (in any form matching CHEMAG_TAG),
 * the body is returned unchanged.
 *
 * `existing` is the file's UTF-8 content, or `null` if it does not exist.
 *
 * Throws `PrecommitUnparseableError` when the existing file cannot be
 * safely modified (binary content, multiple chemag tags pointing at
 * different commands, or any tag whose command is empty).
 */
export function addChemagLine(existing: string | null): AddChemagLineResult {
  if (existing === null) {
    const body = `${DEFAULT_HUSKY_HEADER}${CHEMAG_PRECOMMIT_LINE}\n`;
    return { body, changed: true, alreadyPresent: false };
  }

  assertSafeToEdit(existing);

  const lines = existing.split("\n");
  const taggedIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isChemagLine(lines[i])) taggedIndices.push(i);
  }

  if (taggedIndices.length > 1) {
    throw new PrecommitUnparseableError(
      "",
      `multiple chemag-tagged lines present (${taggedIndices.length}); refusing to merge`,
    );
  }

  if (taggedIndices.length === 1) {
    // Already installed — replace the tagged line with our canonical form
    // (in case the user manually edited the command). Idempotence: if the
    // line is already canonical, body === existing.
    const idx = taggedIndices[0];
    if (lines[idx] === CHEMAG_PRECOMMIT_LINE) {
      return { body: existing, changed: false, alreadyPresent: true };
    }
    lines[idx] = CHEMAG_PRECOMMIT_LINE;
    const body = lines.join("\n");
    return { body, changed: true, alreadyPresent: true };
  }

  // No chemag line yet — append. Preserve a single trailing newline.
  const trimmed = existing.replace(/\n+$/, "");
  const body = `${trimmed}\n${CHEMAG_PRECOMMIT_LINE}\n`;
  return { body, changed: true, alreadyPresent: false };
}

export interface RemoveChemagLinesResult {
  /** Final body, or `null` if the file should be deleted (became empty). */
  body: string | null;
  /** True if any chemag-tagged line was removed. */
  changed: boolean;
}

/**
 * Strip every chemag-tagged line from `.husky/pre-commit`. Returns the new
 * body, or `null` if the file became effectively empty (only whitespace
 * and/or the default shebang remain — the spec asks us to keep the file in
 * place when other content survives, and remove only when truly empty).
 *
 * Throws `PrecommitUnparseableError` if `existing` is unsafe to edit.
 */
export function removeChemagLines(existing: string): RemoveChemagLinesResult {
  assertSafeToEdit(existing);

  const lines = existing.split("\n");
  const filtered: string[] = [];
  let changed = false;
  for (const line of lines) {
    if (isChemagLine(line)) {
      changed = true;
      continue;
    }
    filtered.push(line);
  }

  if (!changed) {
    return { body: existing, changed: false };
  }

  // Collapse leading/trailing blank lines but preserve single trailing newline.
  const trimmed = filtered.join("\n").replace(/\n+$/, "");
  // If only the default shebang (or nothing) remains, treat the file as empty.
  // Otherwise keep it in place. Per the spec: "don't delete the file unless it
  // becomes empty".
  const meaningful = trimmed
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("#!"));
  if (meaningful.length === 0) {
    return { body: null, changed: true };
  }
  return { body: `${trimmed}\n`, changed: true };
}

/** True iff a single line carries the chemag tag. */
function isChemagLine(line: string): boolean {
  // Accept any whitespace before `# _chemag`; reject if our marker is part
  // of a different comment (e.g. `# _chemagic` would not match because of
  // the trailing word boundary).
  return /(^|\s)# _chemag\b/.test(line);
}

function assertSafeToEdit(existing: string): void {
  // Reject obviously binary content. UTF-8 text never contains a NUL byte.
  if (existing.includes(String.fromCharCode(0))) {
    throw new PrecommitUnparseableError("", "file contains NUL bytes (likely binary)");
  }
  // Reject malformed tags: a `# _chemag` marker on a line whose non-tag
  // content is empty would mean we cannot reliably swap commands later.
  const lines = existing.split("\n");
  for (const line of lines) {
    if (!isChemagLine(line)) continue;
    const beforeTag = line.replace(/(^|\s)# _chemag.*$/, "$1").trim();
    if (beforeTag === "") {
      throw new PrecommitUnparseableError(
        "",
        "found a chemag tag on a line with no command — refusing to modify",
      );
    }
  }
}

/**
 * Read `.husky/pre-commit` and return its UTF-8 contents, or `null` if the
 * file does not exist. Wraps `fs.readFileSync` to centralize the
 * unparseable-error path.
 */
export function readPrecommit(precommitPath: string): string | null {
  if (!fs.existsSync(precommitPath)) return null;
  try {
    return fs.readFileSync(precommitPath, "utf-8");
  } catch (e) {
    throw new PrecommitUnparseableError(precommitPath, e instanceof Error ? e.message : String(e));
  }
}

/** Write `.husky/pre-commit` with mode 0755. Creates parent dirs if needed. */
export function writePrecommit(precommitPath: string, body: string): void {
  fs.mkdirSync(path.dirname(precommitPath), { recursive: true });
  fs.writeFileSync(precommitPath, body, { encoding: "utf-8", mode: 0o755 });
  // chmod separately in case the file already existed (writeFileSync's `mode`
  // option only applies when the file is created).
  try {
    fs.chmodSync(precommitPath, 0o755);
  } catch {
    // Filesystems without POSIX mode bits (e.g. some Windows configs) — ok to ignore.
  }
}
