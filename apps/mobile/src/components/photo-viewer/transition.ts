import type { Rect } from "@/lib/rect";

// Pure helper for the shared-element open/close: the transform that maps the
// fullscreen content onto a grid-tile rect (uniform scale, no distortion, +
// translate to the tile center). Marked 'worklet' so it's also usable on the UI
// thread; the directive is a no-op string in plain JS (vitest runs it normally).

export type Collapse = { s: number; tx: number; ty: number };

export function collapseToRect(rect: Rect, screenW: number, screenH: number): Collapse {
  "worklet";
  if (screenW <= 0 || screenH <= 0 || rect.width <= 0) return { s: 0, tx: 0, ty: 0 };
  return {
    s: rect.width / screenW,
    tx: rect.x + rect.width / 2 - screenW / 2,
    ty: rect.y + rect.height / 2 - screenH / 2,
  };
}
