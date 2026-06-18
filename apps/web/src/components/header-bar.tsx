/**
 * Sticky page header shared across the app. Pins to the top of the viewport
 * while page content scrolls beneath it. The -mx-6/px-6 make the solid
 * background span the page's full content width (pages wrap content in `px-6`)
 * so content scrolls cleanly under the bar instead of showing through its sides.
 *
 * Pass the page `title` and optional right-aligned `actions` (buttons etc.).
 */
export function HeaderBar({
  title,
  actions,
}: {
  title: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-6 flex items-center justify-between gap-4 bg-background px-6 py-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
