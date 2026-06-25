import { type FilterRule, parseFilterTokens } from "@lumio/shared";

/** Combine the rules carried by EXIF chips with the rules parsed from the box's free
 *  text. Chip rules come first (panel/committed), then typed-but-unchipped tokens.
 *  No field-level dedup: if a field is both a chip and a typed token (e.g. an `iso:>800`
 *  chip plus typed `iso:>800`), both rules are emitted (redundant but not incorrect
 *  under AND). */
export function mergeEditorRules(chipRules: FilterRule[], freeText: string): { rules: FilterRule[]; q: string } {
  const parsed = parseFilterTokens(freeText);
  return { rules: [...chipRules, ...parsed.rules], q: parsed.text };
}
