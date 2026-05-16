import * as path from "node:path";

/**
 * Options for classifying a file path in terms of its Chem compound and role.
 *
 * Instead of reading workspace.yaml at runtime (which would pull in chemag's
 * loader), consumers supply the relevant path segments directly. This keeps the
 * ESLint plugin runtime-isolated from @chemag/* packages.
 */
export interface PathClassificationOptions {
  /**
   * Absolute path to the directory that contains all compound subdirectories
   * (the value of `paths.compounds` in workspace.yaml, resolved to an absolute
   * path by the consumer).
   *
   * Example: "/project/src/compounds"
   */
  compoundsRoot: string;

  /**
   * Path prefixes (relative to the compound root) or folder names that
   * identify the "adapter" role. Defaults to ["adapters"].
   */
  adapterPaths?: string[];

  /**
   * Path prefixes (relative to the compound root) or folder names that
   * identify the "interface" role. Defaults to ["interfaces"].
   */
  interfacePaths?: string[];

  /**
   * Path prefixes (relative to the compound root) or folder names that
   * identify the "reaction" role. Defaults to ["reactions"].
   */
  reactionPaths?: string[];

  /**
   * Path prefixes (relative to the compound root) or folder names that
   * identify the "catalyst" role. Defaults to ["catalysts"].
   */
  catalystPaths?: string[];
}

export type Role = "adapter" | "interface" | "reaction" | "catalyst" | "unknown";

export interface ClassificationResult {
  /** The compound name (subdirectory name under compoundsRoot), or null if the
   *  path is not inside compoundsRoot at all. */
  compound: string | null;
  /** The role inferred from the path segment following the compound name. */
  role: Role;
}

/**
 * Classify an absolute file path into its Chem compound name and role.
 *
 * The algorithm:
 * 1. Strip the `compoundsRoot` prefix from `absPath`. If the path is not
 *    inside `compoundsRoot`, return `{ compound: null, role: "unknown" }`.
 * 2. The first remaining path segment is the compound name.
 * 3. The second remaining path segment is matched against the role folder
 *    lists. Uses path-prefix matching — no glob library required for the
 *    bench fixtures.
 *
 * Role folder matching is case-sensitive and uses exact segment equality so
 * that a compound named "adapters" is not misclassified as a role folder.
 */
export function classifyPath(
  absPath: string,
  opts: PathClassificationOptions,
): ClassificationResult {
  const adapterFolders = opts.adapterPaths ?? ["adapters"];
  const interfaceFolders = opts.interfacePaths ?? ["interfaces"];
  const reactionFolders = opts.reactionPaths ?? ["reactions"];
  const catalystFolders = opts.catalystPaths ?? ["catalysts"];

  // Normalise both paths to POSIX separators so the logic is consistent on
  // Windows runners and POSIX alike.
  const normRoot = normaliseSep(opts.compoundsRoot);
  const normAbs = normaliseSep(absPath);

  // The root must end with "/" to avoid prefix-matching a sibling directory
  // that starts with the same characters (e.g. "compounds2" matching "compounds").
  const rootPrefix = normRoot.endsWith("/") ? normRoot : `${normRoot}/`;

  if (!normAbs.startsWith(rootPrefix)) {
    return { compound: null, role: "unknown" };
  }

  // Remaining path after the compoundsRoot prefix.
  const rel = normAbs.slice(rootPrefix.length);
  const segments = rel.split("/").filter(Boolean);

  if (segments.length === 0) {
    return { compound: null, role: "unknown" };
  }

  const compound = segments[0];

  if (segments.length < 2) {
    // The path IS the compound root itself (e.g. a compound.yaml at the top).
    return { compound, role: "unknown" };
  }

  const roleSegment = segments[1];

  const role = resolveRole(roleSegment, {
    adapterFolders,
    interfaceFolders,
    reactionFolders,
    catalystFolders,
  });

  return { compound, role };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normaliseSep(p: string): string {
  return p.replace(/\\/g, "/");
}

function resolveRole(
  segment: string,
  folders: {
    adapterFolders: string[];
    interfaceFolders: string[];
    reactionFolders: string[];
    catalystFolders: string[];
  },
): Role {
  if (folders.adapterFolders.includes(segment)) return "adapter";
  if (folders.interfaceFolders.includes(segment)) return "interface";
  if (folders.reactionFolders.includes(segment)) return "reaction";
  if (folders.catalystFolders.includes(segment)) return "catalyst";
  return "unknown";
}

// Re-export path for consumers that need it (avoids a separate import).
export { path };
