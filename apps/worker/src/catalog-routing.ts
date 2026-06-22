import path from "node:path";

/** The catalog whose root is the longest path-prefix of `absPath`, or undefined. */
export function catalogForPath<T extends { path: string }>(catalogs: readonly T[], absPath: string): T | undefined {
  let best: T | undefined;
  let bestLen = -1;
  const probe = absPath.endsWith(path.sep) ? absPath : absPath + path.sep;
  for (const c of catalogs) {
    const root = c.path.endsWith(path.sep) ? c.path : c.path + path.sep;
    if (probe.startsWith(root) && c.path.length > bestLen) {
      best = c;
      bestLen = c.path.length;
    }
  }
  return best;
}
