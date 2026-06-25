import { LightboxTab } from "./lightbox-tab";

/** What a grid keypress resolves to. `null` means "do nothing". */
export type GridShortcutAction =
  | { kind: "favorite" }
  | { kind: "open"; tab: LightboxTab }
  | { kind: "trash" }
  | null;

export interface GridShortcutInput {
  /** `KeyboardEvent.key`. */
  key: string;
  /** Any of meta/ctrl/alt/shift held. */
  hasModifier: boolean;
  /** `KeyboardEvent.repeat` (auto-repeat from a held key). */
  repeat: boolean;
  /** Number of currently selected photos. */
  selectionSize: number;
  /** The lightbox is open (it owns the keyboard then). */
  lightboxOpen: boolean;
  /** Focus is in an input/textarea/contentEditable. */
  inEditable: boolean;
  /** A Radix dialog/alertdialog/menu is open. */
  overlayOpen: boolean;
}

/**
 * Decide what a grid keypress should do. Pure: all DOM/context facts are passed
 * in, so it is fully unit-testable. The thin `GridShortcuts` component supplies
 * these facts and dispatches the returned action.
 */
export function resolveGridShortcut(input: GridShortcutInput): GridShortcutAction {
  if (
    input.lightboxOpen ||
    input.hasModifier ||
    input.repeat ||
    input.inEditable ||
    input.overlayOpen
  ) {
    return null;
  }
  switch (input.key.toLowerCase()) {
    case "f":
      return input.selectionSize >= 1 ? { kind: "favorite" } : null;
    case "enter":
      return input.selectionSize === 1 ? { kind: "open", tab: LightboxTab.Info } : null;
    case "e":
      return input.selectionSize === 1 ? { kind: "open", tab: LightboxTab.Edit } : null;
    case "backspace":
    case "delete":
      return input.selectionSize >= 1 ? { kind: "trash" } : null;
    default:
      return null;
  }
}
