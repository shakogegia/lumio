import { describe, it, expect } from "vitest";
import { collapseToRect } from "./transition";

describe("collapseToRect", () => {
  it("maps fullscreen content onto a tile rect (uniform scale + center translate)", () => {
    // 100x100 tile at (0,0) on a 400x800 screen.
    const t = collapseToRect({ x: 0, y: 0, width: 100, height: 100 }, 400, 800);
    expect(t.s).toBeCloseTo(0.25);
    expect(t.tx).toBeCloseTo(50 - 200); // tile center x (50) - screen center x (200)
    expect(t.ty).toBeCloseTo(50 - 400);
  });
  it("collapses to nothing for a zero-size rect (fade-to-center fallback)", () => {
    expect(collapseToRect({ x: 200, y: 400, width: 0, height: 0 }, 400, 800)).toEqual({
      s: 0,
      tx: 0,
      ty: 0,
    });
  });
});
