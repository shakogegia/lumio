/**
 * Human-readable count label, e.g. `countLabel(1, "photo", "photos")` → "1 photo"
 * and `countLabel(1234, "photo", "photos")` → "1,234 photos". The number is
 * comma-grouped via `toLocaleString` so large libraries read cleanly.
 */
export function countLabel(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}
