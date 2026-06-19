import { GRID_GAP, MIN_TILE } from "@/lib/grid-layout";

// Placeholder tiles rendered before the first page loads. Generous enough to
// fill a large (4K) viewport; the container clips overflow to the viewport, so
// the extras are harmless on smaller screens.
const SKELETON_TILES = 120;

/**
 * Warm-grey placeholder shown until the first page loads. Pure CSS (auto-fill
 * columns + square tiles) so it needs no measured width — it's in the server
 * HTML and paints on the first frame, even on a fast refresh before hydration.
 * auto-fill with the same MIN_TILE/GRID_GAP yields the same column count as the
 * real grid, so the swap to real photos is seamless.
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
          <div key={i} className="aspect-square rounded-sm bg-skeleton" />
        ))}
      </div>
    </div>
  );
}
