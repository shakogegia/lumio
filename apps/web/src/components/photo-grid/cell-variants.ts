import { cva } from "class-variance-authority";

/**
 * The clickable grid cell. In `card` mode it gains a surface + padding so the
 * contained photo floats on a card (and leaves room for future label/rating/
 * title chrome); `fill` and `fit` are chrome-less. Corners are square (no
 * rounding) in every mode. `selected` shows a blue inset ring (selection is
 * always available — there is no separate select mode).
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
      selected: {
        true: "ring-2 ring-inset ring-blue-500",
        false: "",
      },
    },
    defaultVariants: { mode: "fill", selected: false },
  },
);
