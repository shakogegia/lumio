// Default target tile width. Used by computeColumns and the skeleton when no
// user size is set. Also the default value of the grid-size store.
export const MIN_TILE = 280;
export const GRID_GAP = 4;

// Bounds for the user-adjustable tile size (the grid-size slider). Distinct from
// MIN_TILE (the *default*): TILE_SIZE_MIN/MAX are the slider's endpoints.
export const TILE_SIZE_MIN = 160;
export const TILE_SIZE_MAX = 400;
export const TILE_SIZE_STEP = 40;

export function computeColumns(width: number, minTile: number = MIN_TILE, gap: number = GRID_GAP): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (minTile + gap)));
}

export function rowCount(itemCount: number, columns: number): number {
  if (columns <= 0 || itemCount <= 0) return 0;
  return Math.ceil(itemCount / columns);
}
