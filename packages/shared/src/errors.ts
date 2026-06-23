/**
 * Safe error-message extractor. Avoids the unsafe `(e as Error).message` cast
 * that silently returns `undefined` for non-Error throwables (strings, plain
 * objects, null, etc.).
 *
 * @example
 *   try { … } catch (e) { console.warn(errorMessage(e)); }
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
