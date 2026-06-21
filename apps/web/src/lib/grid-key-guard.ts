/**
 * True when a global selection key (Escape, arrows, Enter) should be ignored
 * because the user is typing in a field or an overlay (dialog / menu) owns the
 * keyboard. Shared by the grid's Escape-to-clear and arrow-nav handlers so they
 * stay in lockstep.
 */
export function keyboardTargetBlocked(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (el?.isContentEditable || el?.closest("input, textarea, select")) return true;
  return !!document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
  );
}
