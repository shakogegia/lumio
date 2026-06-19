import { cva } from "class-variance-authority";

/**
 * The clickable grid cell. In `card` mode it gains a surface + padding so the
 * contained photo floats on a card (and leaves room for future label/rating/
 * title chrome); `fill` and `fit` are chrome-less. `selected` is only ever true
 * in select mode.
 */
export const cellVariants = cva(
  "relative block h-full rounded-sm outline-none transition-colors focus:outline-none focus-visible:outline-none",
  {
    variants: {
      mode: {
        fill: "",
        fit: "",
        card: "bg-muted p-2",
      },
      selected: {
        true: "ring-2 ring-inset ring-primary",
        false: "",
      },
    },
    defaultVariants: { mode: "fill", selected: false },
  },
);
