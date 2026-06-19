import { GRID_GAP, MIN_TILE } from "@/lib/grid-layout";

// Placeholder tiles rendered before the first page loads. Generous enough to
// fill a large (4K) viewport; the container clips overflow to the viewport, so
// the extras are harmless on smaller screens.
const SKELETON_TILES = 120;

/**
 * Muted-grey placeholder shown until the first page loads. Pure CSS (auto-fill
 * columns + square tiles) so it needs no measured width — it's in the server
 * HTML and paints on the first frame, even on a fast refresh before hydration.
 * auto-fill with MIN_TILE/GRID_GAP matches the real grid's column count at the
 * default tile size, so the swap to real photos is seamless there; if the user
 * has picked a non-default grid size, the grid reflows once real photos load.
 */
export function PhotoGridSkeleton({ listRef }: { listRef: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={listRef} style={{ maxHeight: "100vh", overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_TILE}px, 1fr))`,
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
