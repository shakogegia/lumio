export interface FolderBrowserShortcutInput {
  /** `KeyboardEvent.key`. */
  key: string;
  /** Any of meta/ctrl/alt/shift held. */
  hasModifier: boolean;
  /** `KeyboardEvent.repeat` (auto-repeat from a held key). */
  repeat: boolean;
  /** Number of currently selected folders/albums. */
  selectionSize: number;
  /** Focus is in an input/textarea/contentEditable. */
  inEditable: boolean;
  /** A dialog/alertdialog/menu (incl. a context menu) is open. */
  overlayOpen: boolean;
}

/**
 * Decide whether an Enter press should open the single selected folder/album.
 * Pure: all DOM/context facts are passed in, so it is fully unit-testable. Enter
 * opens only when exactly one item is selected (you can't "go into" several), and
 * never while typing, while an overlay is open, on a modified press, or a repeat.
 */
export function shouldOpenSelectedItem(input: FolderBrowserShortcutInput): boolean {
  if (input.hasModifier || input.repeat || input.inEditable || input.overlayOpen) {
    return false;
  }
  return input.key === "Enter" && input.selectionSize === 1;
}
