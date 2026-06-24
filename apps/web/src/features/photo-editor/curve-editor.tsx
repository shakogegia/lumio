"use client";

import { useRef, useState } from "react";
import { sampleCurve, type CurvePoint, type CurveSpec } from "@lumio/shared";
import { cn } from "@/lib/utils";
import { useEditSession } from "./use-edit-session";

const CHANNELS: { key: keyof CurveSpec; label: string; stroke: string; dot: string }[] = [
  { key: "master", label: "RGB", stroke: "rgb(229 231 235)", dot: "bg-zinc-200" },
  { key: "r", label: "R", stroke: "rgb(248 113 113)", dot: "bg-red-400" },
  { key: "g", label: "G", stroke: "rgb(74 222 128)", dot: "bg-green-400" },
  { key: "b", label: "B", stroke: "rgb(96 165 250)", dot: "bg-blue-400" },
];

const IDENTITY: CurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
];
const HIT = 0.05; // pointer hit radius in normalized units
const SAMPLES = 48;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Draggable tone-curve editor. Click empty space to add a point, drag to move,
 *  double-click an interior point to remove it. Endpoints move only vertically.
 *  Commits one history entry per gesture via `setCurve`. */
export function CurveEditor() {
  const { working, setCurve } = useEditSession();
  const [channel, setChannel] = useState<keyof CurveSpec>("master");
  const boxRef = useRef<HTMLDivElement>(null);
  // In-progress gesture: the dragged index + the working points (kept in a ref so
  // fast pointer moves never read stale state). `live` mirrors it for rendering.
  const drag = useRef<{ index: number; pts: CurvePoint[] } | null>(null);
  const [live, setLive] = useState<CurvePoint[] | null>(null);

  const committed = working.curves?.[channel] ?? IDENTITY;
  const points = live ?? committed;
  const active = CHANNELS.find((c) => c.key === channel)!;

  const toNorm = (e: { clientX: number; clientY: number }): CurvePoint => {
    const r = boxRef.current!.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01(1 - (e.clientY - r.top) / r.height) };
  };

  const nearest = (n: CurvePoint, pts: CurvePoint[]): number => {
    let idx = -1;
    let best = HIT;
    pts.forEach((p, i) => {
      const d = Math.hypot(p.x - n.x, p.y - n.y);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    return idx;
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    const n = toNorm(e);
    let idx = nearest(n, points);
    let pts = points;
    if (idx === -1) {
      pts = [...points, n].sort((a, b) => a.x - b.x);
      idx = pts.indexOf(n);
    }
    drag.current = { index: idx, pts };
    boxRef.current?.setPointerCapture(e.pointerId);
    setLive(pts);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) return;
    const n = toNorm(e);
    const pts = d.pts;
    const isFirst = d.index === 0;
    const isLast = d.index === pts.length - 1;
    const lo = isFirst ? 0 : pts[d.index - 1]!.x + 1e-3;
    const hi = isLast ? 1 : pts[d.index + 1]!.x - 1e-3;
    const x = isFirst ? 0 : isLast ? 1 : Math.min(Math.max(n.x, lo), hi);
    const updated = pts.map((p, j) => (j === d.index ? { x, y: n.y } : p));
    d.pts = updated;
    setLive(updated);
  };

  const onPointerUp = (): void => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setCurve(channel, d.pts);
    setLive(null);
  };

  const onDoubleClick = (e: React.MouseEvent): void => {
    const n = toNorm(e);
    const idx = nearest(n, committed);
    if (idx > 0 && idx < committed.length - 1) {
      setCurve(channel, committed.filter((_, i) => i !== idx));
    }
  };

  // Curve path in a 0..1 viewBox (y flipped). non-scaling-stroke keeps the line
  // crisp under the non-uniform viewBox→box scale.
  const lut = sampleCurve(points, SAMPLES);
  const path = Array.from(lut, (y, i) => `${i === 0 ? "M" : "L"} ${i / (SAMPLES - 1)},${1 - y}`).join(" ");

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="font-medium text-muted-foreground">Curve</p>
        <div className="flex gap-1">
          {CHANNELS.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={channel === c.key}
              onClick={() => setChannel(c.key)}
              className={cn(
                "flex size-6 items-center justify-center rounded text-[10px] font-medium",
                channel === c.key ? "bg-foreground/15 text-foreground" : "text-muted-foreground hover:bg-foreground/10",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={boxRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        className="relative h-40 w-full cursor-crosshair touch-none rounded-md border border-border bg-muted/30"
      >
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
          {/* rule-of-thirds grid + diagonal reference */}
          {[1 / 3, 2 / 3].map((t) => (
            <g key={t}>
              <line x1={t} y1={0} x2={t} y2={1} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" className="text-border" />
              <line x1={0} y1={t} x2={1} y2={t} stroke="currentColor" strokeWidth={1} vectorEffect="non-scaling-stroke" className="text-border" />
            </g>
          ))}
          <line x1={0} y1={1} x2={1} y2={0} stroke="currentColor" strokeWidth={1} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" className="text-muted-foreground/40" />
          <path d={path} fill="none" stroke={active.stroke} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((p, i) => (
          <span
            key={i}
            aria-hidden
            className={cn("pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/30", active.dot)}
            style={{ left: `${p.x * 100}%`, top: `${(1 - p.y) * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
