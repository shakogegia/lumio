import type { AlbumSummaryDTO, FolderDTO } from "@lumio/shared";

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

function groupFolders(folders: FolderDTO[]): Map<string | null, FolderDTO[]> {
  const byParent = new Map<string | null, FolderDTO[]>();
  for (const f of folders) {
    const arr = byParent.get(f.parentId) ?? [];
    arr.push(f);
    byParent.set(f.parentId, arr);
  }
  return byParent;
}

export interface AlbumTreeNode {
  id: string;
  name: string;
  /** Albums directly in this folder (sorted). */
  albums: AlbumSummaryDTO[];
  /** Child folders that contain a pickable album somewhere beneath (sorted). */
  folders: AlbumTreeNode[];
}

/**
 * The folder/album hierarchy as a NESTED tree for true submenu pickers ("Add to
 * album"): top-level albums + folder nodes, each with its direct albums and child
 * folder nodes. Smart albums and `excludeAlbumId` are filtered out; folders with no
 * pickable album anywhere beneath are pruned (unless `includeEmptyFolders`).
 */
export function buildAlbumTree(
  folders: FolderDTO[],
  albums: AlbumSummaryDTO[],
  opts: { excludeAlbumId?: string; includeSmart?: boolean; includeEmptyFolders?: boolean } = {},
): { albums: AlbumSummaryDTO[]; folders: AlbumTreeNode[] } {
  const pickable = albums.filter(
    (a) => (opts.includeSmart || !a.isSmart) && a.id !== opts.excludeAlbumId,
  );
  const albumsByFolder = new Map<string | null, AlbumSummaryDTO[]>();
  for (const a of pickable) {
    const arr = albumsByFolder.get(a.folderId) ?? [];
    arr.push(a);
    albumsByFolder.set(a.folderId, arr);
  }
  const childFolders = groupFolders(folders);

  const buildNode = (f: FolderDTO): AlbumTreeNode | null => {
    const childNodes: AlbumTreeNode[] = [];
    for (const c of (childFolders.get(f.id) ?? []).slice().sort(byName)) {
      const node = buildNode(c);
      if (node) childNodes.push(node);
    }
    const directAlbums = (albumsByFolder.get(f.id) ?? []).slice().sort(byName);
    if (!opts.includeEmptyFolders && directAlbums.length === 0 && childNodes.length === 0) {
      return null;
    }
    return { id: f.id, name: f.name, albums: directAlbums, folders: childNodes };
  };

  const rootFolders: AlbumTreeNode[] = [];
  for (const f of (childFolders.get(null) ?? []).slice().sort(byName)) {
    const node = buildNode(f);
    if (node) rootFolders.push(node);
  }
  return {
    albums: (albumsByFolder.get(null) ?? []).slice().sort(byName),
    folders: rootFolders,
  };
}

export interface FolderPickerRow {
  id: string;
  name: string;
  depth: number;
  disabled: boolean;
}

/**
 * Ordered, depth-tagged folder rows for the "Move to…" picker. `excludeSubtreeOf`
 * (a folder being moved) disables that folder and all its descendants so it can't be
 * moved into itself or a child (the server enforces this too).
 */
export function buildFolderPickerRows(
  folders: FolderDTO[],
  opts: { excludeSubtreeOf?: string } = {},
): FolderPickerRow[] {
  const childFolders = groupFolders(folders);
  const disabled = new Set<string>();
  if (opts.excludeSubtreeOf) {
    const stack = [opts.excludeSubtreeOf];
    while (stack.length) {
      const id = stack.pop() as string;
      disabled.add(id);
      for (const c of childFolders.get(id) ?? []) stack.push(c.id);
    }
  }
  const rows: FolderPickerRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of (childFolders.get(parentId) ?? []).slice().sort(byName)) {
      rows.push({ id: f.id, name: f.name, depth, disabled: disabled.has(f.id) });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
