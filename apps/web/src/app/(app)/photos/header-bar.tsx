/**
 * Sticky page header shared by the photo/album views. Stays pinned to the top
 * while the grid scrolls beneath it. The -mx-6/px-6 make the solid background
 * span the page's full content width (pages wrap content in `p-6`) so grid items
 * scroll cleanly under the bar instead of showing through its sides.
 */
export function HeaderBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky top-0 z-20 -mx-6 flex items-center justify-between gap-4 bg-background px-6 py-4">
      {children}
    </div>
  );
}
