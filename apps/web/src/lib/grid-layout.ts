export const MIN_TILE = 280;
export const GRID_GAP = 4;

export function computeColumns(width: number, minTile: number = MIN_TILE, gap: number = GRID_GAP): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (minTile + gap)));
}

export function rowCount(itemCount: number, columns: number): number {
  if (columns <= 0 || itemCount <= 0) return 0;
  return Math.ceil(itemCount / columns);
}
