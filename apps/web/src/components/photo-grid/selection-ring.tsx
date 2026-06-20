import { cn } from "@/lib/utils";

/**
 * Selection affordance for a grid tile: a blue band with a thin white hairline
 * just inside it, drawn as an inset box-shadow on an absolutely-positioned
 * overlay. Drawing it on top (rather than as the cell's own `ring`) keeps it
 * visible even when a full-bleed `fill` photo covers the cell; the white line
 * keeps the blue readable when the photo underneath is itself blue.
 *
 * Render it as the last child of a `relative` container, gated on the selected
 * state. Pass `className` (e.g. `rounded-sm`) to match the container's corners;
 * photo cells are square and pass nothing.
 */
export function SelectionRing({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 z-10", className)}
      // 2px blue band, then a 1px white line on its inner edge.
      style={{ boxShadow: "inset 0 0 0 2px #3b82f6, inset 0 0 0 3px #ffffff" }}
    />
  );
}
