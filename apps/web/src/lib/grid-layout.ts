export const GRID_GAP = 4;

// Bounds for the user-adjustable grid density (columns per row). The slider
// picks a whole number of columns in this range; tiles scale to fill the row,
// so every step changes the layout at any viewport width.
export const COLUMNS_MIN = 2;
export const COLUMNS_MAX = 12;
export const DEFAULT_COLUMNS = 5;

export function rowCount(itemCount: number, columns: number): number {
  if (columns <= 0 || itemCount <= 0) return 0;
  return Math.ceil(itemCount / columns);
}
