import { GRID_GAP } from "@/lib/grid-layout";

// Placeholder tiles rendered before the first page loads. Generous enough to
// fill a large (4K) viewport; the container clips overflow to the viewport, so
// the extras are harmless on smaller screens.
const SKELETON_TILES = 120;

/**
 * Muted-grey placeholder shown until the first page loads. Pure CSS (a fixed
 * `columns`-wide grid of square tiles) so it needs no measured width — it's in
 * the server HTML and paints on the first frame, even on a fast refresh before
 * hydration. The column count comes from the --grid-columns CSS variable, which
 * the root layout's pre-paint script sets from localStorage, so the skeleton
 * paints at the chosen density immediately instead of flashing the default and
 * snapping once hydration reads the store. The `columns` prop is the fallback
 * (server render / no script): it matches the real grid, so the swap is seamless.
 */
export function PhotoGridSkeleton({
  listRef,
  columns,
}: {
  listRef: React.Ref<HTMLDivElement>;
  columns: number;
}) {
  return (
    <div ref={listRef} style={{ maxHeight: "100vh", overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(var(--grid-columns, ${columns}), minmax(0, 1fr))`,
          gap: GRID_GAP,
        }}
      >
        {Array.from({ length: SKELETON_TILES }).map((_, i) => (
          <div key={i} className="aspect-square rounded-sm bg-muted" />
        ))}
      </div>
    </div>
  );
}
