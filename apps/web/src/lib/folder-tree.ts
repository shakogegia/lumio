/** Minimal folder shape the tree helpers need; satisfied by Prisma `Folder` rows. */
export interface FolderNode {
  id: string;
  parentId: string | null;
  name?: string;
}

/** Map each parentId (null = top level) to its direct child folder ids. */
function buildChildIndex(folders: FolderNode[]): Map<string | null, string[]> {
  const index = new Map<string | null, string[]>();
  for (const f of folders) {
    const arr = index.get(f.parentId) ?? [];
    arr.push(f.id);
    index.set(f.parentId, arr);
  }
  return index;
}

/** All descendant folder ids of `rootId`, INCLUDING `rootId` itself. */
export function collectDescendantFolderIds(folders: FolderNode[], rootId: string): string[] {
  const childIndex = buildChildIndex(folders);
  const out: string[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    out.push(id);
    for (const child of childIndex.get(id) ?? []) stack.push(child);
  }
  return out;
}

/** Ancestor chain from the top-level folder down to `folderId` (inclusive). */
export function folderBreadcrumbs(folders: FolderNode[], folderId: string): FolderNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const chain: FolderNode[] = [];
  let cur = byId.get(folderId);
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}
