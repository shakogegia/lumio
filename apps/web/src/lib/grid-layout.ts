export const GRID_GAP = 4;

// Bounds for the user-adjustable grid density (columns per row). The slider
// picks a whole number of columns in this range; tiles scale to fill the row,
// so every step changes the layout at any viewport width.
export const COLUMNS_MIN = 2;
export const COLUMNS_MAX = 12;
// Default photo-tile density. More columns means smaller tiles, so the smallest
// grid size is COLUMNS_MAX columns.
export const DEFAULT_COLUMNS = COLUMNS_MAX;

// localStorage key for the persisted column count. Shared by the client store
// and the pre-paint inline script in the root layout (which reads it to set the
// --grid-columns CSS variable before first paint, so the skeleton doesn't flash
// the default size before hydration reads localStorage).
export const GRID_COLUMNS_STORAGE_KEY = "lumio:grid-columns";

// localStorage key for the /albums listing density. Separate from
// GRID_COLUMNS_STORAGE_KEY so resizing album cards never changes photo-tile
// density (and vice versa).
export const ALBUM_COLUMNS_STORAGE_KEY = "lumio:album-columns";

// Default album-card density. The grid-size slider runs small-tiles/many-columns
// (left) → large-tiles/few-columns (right) over [COLUMNS_MIN..COLUMNS_MAX]; the
// 3rd tick from the left is slider value COLUMNS_MIN + 2 → COLUMNS_MAX - 2 = 10
// columns. (Photos keep their own DEFAULT_COLUMNS.)
export const ALBUM_DEFAULT_COLUMNS = 10;

export function rowCount(itemCount: number, columns: number): number {
  if (columns <= 0 || itemCount <= 0) return 0;
  return Math.ceil(itemCount / columns);
}

/** Fixed fetch page size for the grid (independent of column density so the
 *  sparse page store's index math stays stable when columns change). API max. */
export const PHOTO_PAGE_SIZE = 100;
