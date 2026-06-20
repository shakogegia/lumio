import { cva } from "class-variance-authority";

/**
 * The clickable grid cell. In `card` mode it gains a surface + padding so the
 * contained photo floats on a card (and leaves room for future label/rating/
 * title chrome); `fill` and `fit` are chrome-less. Corners are square (no
 * rounding) in every mode. The blue selection ring is drawn on top by
 * `SelectionRing` (so it stays visible even when a `fill` photo covers the
 * cell), not here.
 */
export const cellVariants = cva(
  "relative block h-full outline-none transition-colors focus:outline-none focus-visible:outline-none",
  {
    variants: {
      mode: {
        fill: "",
        fit: "",
        card: "bg-muted p-2",
      },
    },
    defaultVariants: { mode: "fill" },
  },
);
