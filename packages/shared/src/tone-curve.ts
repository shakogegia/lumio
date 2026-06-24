/** A control point of a tone curve, in normalized [0,1] input(x) → output(y). */
export interface CurvePoint {
  x: number;
  y: number;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Sample a tone curve defined by control `points` into an `n`-entry transfer table
 * over input [0,1] — `table[i]` is the curve evaluated at `i / (n - 1)`, clamped to
 * [0,1]. Fewer than two (distinct-x) points ⇒ identity (`table[i] = i/(n-1)`).
 *
 * Uses monotone cubic (Fritsch–Carlson) interpolation: the curve passes through
 * every control point with C¹ continuity and **no overshoot** — a natural cubic
 * spline would ring above/below the data and produce non-monotone, ugly tone
 * curves. Beyond the first/last point the curve is held flat at that point's y.
 *
 * `!` non-null assertions below are on indexes proven in-bounds by the surrounding
 * loop bounds (the project enables noUncheckedIndexedAccess).
 */
export function sampleCurve(points: CurvePoint[], n: number): Float32Array {
  const out = new Float32Array(n);
  const identity = (): Float32Array => {
    for (let i = 0; i < n; i++) out[i] = i / (n - 1);
    return out;
  };
  if (!points || points.length < 2) return identity();

  // Sanitize: clamp to [0,1], sort by x, drop duplicate x (keep first).
  const sorted = points.map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) })).sort((a, b) => a.x - b.x);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of sorted) {
    if (xs.length && Math.abs(p.x - xs[xs.length - 1]!) < 1e-9) continue;
    xs.push(p.x);
    ys.push(p.y);
  }
  const m = xs.length;
  if (m < 2) {
    out.fill(clamp01(ys[0] ?? 0));
    return out;
  }

  // Secant slopes and Fritsch–Carlson monotone tangents.
  const dx: number[] = new Array(m - 1);
  const slope: number[] = new Array(m - 1);
  for (let i = 0; i < m - 1; i++) {
    dx[i] = xs[i + 1]! - xs[i]!;
    slope[i] = (ys[i + 1]! - ys[i]!) / dx[i]!;
  }
  const tan: number[] = new Array(m);
  tan[0] = slope[0]!;
  tan[m - 1] = slope[m - 2]!;
  for (let i = 1; i < m - 1; i++) {
    tan[i] = slope[i - 1]! * slope[i]! <= 0 ? 0 : (slope[i - 1]! + slope[i]!) / 2;
  }
  // Clamp tangents to keep the interpolant monotone.
  for (let i = 0; i < m - 1; i++) {
    if (slope[i] === 0) {
      tan[i] = 0;
      tan[i + 1] = 0;
    } else {
      const a = tan[i]! / slope[i]!;
      const b = tan[i + 1]! / slope[i]!;
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        tan[i] = t * a * slope[i]!;
        tan[i + 1] = t * b * slope[i]!;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    out[i] = clamp01(evalHermite(xs, ys, tan, dx, i / (n - 1)));
  }
  return out;
}

function evalHermite(xs: number[], ys: number[], tan: number[], dx: number[], x: number): number {
  const m = xs.length;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[m - 1]!) return ys[m - 1]!;
  let i = 0;
  while (i < m - 1 && x > xs[i + 1]!) i++;
  const h = dx[i]!;
  const t = (x - xs[i]!) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * ys[i]! + h10 * h * tan[i]! + h01 * ys[i + 1]! + h11 * h * tan[i + 1]!;
}
