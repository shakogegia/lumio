"use client";

import { Folder as FolderIcon, Home } from "lucide-react";
import { useLibraryTree } from "@/components/library-tree/library-tree";
import { buildFolderPickerRows } from "@/lib/library-tree-rows";

/** Menu-item component from whichever menu family hosts the list (context-menu or
 *  dropdown-menu — their item props are compatible). */
type ItemComponent = React.ComponentType<{
  onSelect?: (event: Event) => void;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}>;

const INDENT = 12;

/**
 * The folder tree rendered inline inside a menu as move destinations: "Top level"
 * then every folder, indented by depth. `excludeSubtreeOf` (a folder being moved)
 * disables that folder and its descendants. Reads the shared LibraryTreeProvider.
 * Family-agnostic — pass the host menu's `Item`.
 */
export function MovePickerItems({
  Item,
  excludeSubtreeOf,
  onPick,
}: {
  Item: ItemComponent;
  excludeSubtreeOf?: string;
  onPick: (targetFolderId: string | null) => void;
}) {
  const { folders } = useLibraryTree();
  const rows = buildFolderPickerRows(folders, { excludeSubtreeOf });

  return (
    <>
      <Item onSelect={() => onPick(null)} style={{ paddingLeft: 8 }}>
        <Home aria-hidden />
        Top level
      </Item>
      {rows.map((row) => (
        <Item
          key={row.id}
          disabled={row.disabled}
          onSelect={() => {
            if (!row.disabled) onPick(row.id);
          }}
          style={{ paddingLeft: 8 + (row.depth + 1) * INDENT }}
        >
          <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{row.name}</span>
        </Item>
      ))}
    </>
  );
}
