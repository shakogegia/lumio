/**
 * Client helpers for the global server-filesystem browser
 * (`GET /api/fs/browse`), used by the folder-browser dialog. The route is
 * bounded to `MEDIA_ROOT`; `parent` is null at the root.
 */

export interface BrowseResult {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
}

/**
 * Fetch the listing for `path` (absolute, server-side). With no `path`, the
 * route returns the `MEDIA_ROOT` listing. Throws on a non-OK response (e.g. a
 * 400 for an out-of-root or bad path) so callers can show an inline error.
 */
export async function fetchBrowse(path?: string): Promise<BrowseResult> {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  const res = await fetch(`/api/fs/browse${qs}`);
  if (!res.ok) throw new Error(`Browse failed (${res.status})`);
  return (await res.json()) as BrowseResult;
}

export interface BreadcrumbSegment {
  /** Display label for the segment. */
  name: string;
  /** Absolute path this segment navigates to when clicked. */
  path: string;
}

/**
 * Split an absolute POSIX path into clickable breadcrumb segments, each
 * carrying the absolute path of that ancestor. The leading segment (the media
 * root) is labelled `rootLabel`; any path at or below the root collapses its
 * above-root prefix into that single root crumb.
 *
 * e.g. breadcrumbSegments("/media/2024/trip", "/media", "Media")
 *   → [ {name:"Media", path:"/media"},
 *       {name:"2024",  path:"/media/2024"},
 *       {name:"trip",  path:"/media/2024/trip"} ]
 */
export function breadcrumbSegments(
  currentPath: string,
  rootPath: string,
  rootLabel: string,
): BreadcrumbSegment[] {
  const root = rootPath.replace(/\/+$/, "") || "/";
  const segments: BreadcrumbSegment[] = [{ name: rootLabel, path: root }];

  // Only the portion below the root is broken into crumbs.
  if (currentPath === root || !currentPath.startsWith(root + "/")) {
    return segments;
  }

  const rest = currentPath.slice(root.length + 1);
  let acc = root;
  for (const part of rest.split("/")) {
    if (!part) continue;
    acc = `${acc}/${part}`;
    segments.push({ name: part, path: acc });
  }
  return segments;
}
