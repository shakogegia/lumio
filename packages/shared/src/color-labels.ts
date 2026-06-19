import { z } from "zod";

/**
 * The fixed pastel color-label palette — the single source of truth for slugs,
 * display names, order, and hex. The Prisma `ColorLabel` enum mirrors these
 * slugs 1:1; renaming or recoloring needs no migration, only editing this file.
 * Numbers (1..8) in the UI are just the array order.
 */
export const colorLabelSchema = z.enum([
  "gray",
  "pink",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
]);

export type ColorLabel = z.infer<typeof colorLabelSchema>;

/** Ordered tuple of valid slugs, derived from the schema (keeps them in lockstep). */
export const COLOR_LABEL_SLUGS = colorLabelSchema.options;

export const COLOR_LABELS: ReadonlyArray<{ slug: ColorLabel; name: string; hex: string }> = [
  { slug: "gray", name: "Gray", hex: "#DBCBCE" },
  { slug: "pink", name: "Pink", hex: "#FFD2CE" },
  { slug: "orange", name: "Orange", hex: "#FAD5B4" },
  { slug: "yellow", name: "Yellow", hex: "#F8E9B7" },
  { slug: "green", name: "Green", hex: "#D0E3C9" },
  { slug: "cyan", name: "Cyan", hex: "#B3DDE0" },
  { slug: "blue", name: "Blue", hex: "#CAD2EE" },
  { slug: "purple", name: "Purple", hex: "#E4C8E7" },
];

const HEX_BY_SLUG = Object.fromEntries(
  COLOR_LABELS.map((c) => [c.slug, c.hex]),
) as Record<ColorLabel, string>;

/** The hex for a label, or `undefined` when unlabeled. */
export function colorLabelHex(label: ColorLabel | null | undefined): string | undefined {
  return label ? HEX_BY_SLUG[label] : undefined;
}
