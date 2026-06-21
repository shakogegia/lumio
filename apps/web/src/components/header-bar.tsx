/**
 * Sticky page header shared across the app. Pins to the top of the viewport
 * while page content scrolls beneath it. The -mx-4/px-4 make the solid
 * background span the page's full content width (pages wrap content in `px-4`)
 * so content scrolls cleanly under the bar instead of showing through its sides.
 *
 * Pass the page `title`, an optional `subtitle` shown beneath it (e.g. a photo
 * count), and optional right-aligned `actions` (buttons etc.).
 */
export function HeaderBar({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-4 bg-background px-4 py-2">
      <div className="min-w-0">
        <h1 className="text-sm font-semibold">{title}</h1>
        {subtitle ? (
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
