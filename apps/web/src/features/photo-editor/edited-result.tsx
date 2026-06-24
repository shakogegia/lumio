"use client";

import { useEffect, useRef, useState } from "react";
import {
  centeredAspectCrop,
  straightenedSize,
  type CropRect,
  type PhotoEdits,
  type WbBaseline,
} from "@lumio/shared";
import { BaseImageStage } from "./base-image-stage";

/** WYSIWYG render of the working recipe: the edit-free base with COLOR + flip/
 *  rotate/straighten applied, CLIPPED to the crop region and fit to this element's
 *  box. Color now lives in BaseImageStage (GPU), so this just frames + clips.
 *  Self-contained — placed inside the zoom container so pan/zoom scale it whole.
 *  Swaps to the full-res base once `zoomed`. */
export function EditedResult({
  src,
  fullSrc,
  zoomed,
  working,
  baseline,
  orientedBase,
  onBaseSize,
}: {
  src: string;
  fullSrc: string;
  zoomed: boolean;
  working: PhotoEdits;
  baseline: WbBaseline;
  orientedBase: { w: number; h: number } | null;
  onBaseSize: (s: { w: number; h: number }) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const apply = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Once zoomed, decode the full-res base then swap it in (crisp deep zoom).
  const [hiRes, setHiRes] = useState(false);
  useEffect(() => {
    if (!zoomed || hiRes) return;
    let cancelled = false;
    const img = new Image();
    img.src = fullSrc;
    img
      .decode()
      .then(() => {
        if (!cancelled) setHiRes(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [zoomed, hiRes, fullSrc]);
  const imgSrc = hiRes ? fullSrc : src;

  const theta = working.straighten ?? 0;
  const effectiveCrop: CropRect = orientedBase
    ? working.crop ??
      (theta !== 0
        ? centeredAspectCrop(orientedBase.w / orientedBase.h, orientedBase.w, orientedBase.h, theta)
        : { x: 0, y: 0, w: 1, h: 1 })
    : { x: 0, y: 0, w: 1, h: 1 };

  let inner: React.ReactNode = null;
  if (orientedBase && box.w > 0 && box.h > 0) {
    const { w: wp, h: hp } = straightenedSize(orientedBase.w, orientedBase.h, theta);
    const cropAspect = (effectiveCrop.w * wp) / (effectiveCrop.h * hp);
    // Fit the cropped result (cropAspect) inside the available box.
    let bw = box.w;
    let bh = box.w / cropAspect;
    if (bh > box.h) {
      bh = box.h;
      bw = box.h * cropAspect;
    }
    const stageW = bw / effectiveCrop.w;
    const stageH = bh / effectiveCrop.h;
    inner = (
      <div className="relative overflow-hidden" style={{ width: bw, height: bh }}>
        <div
          className="absolute"
          style={{
            width: stageW,
            height: stageH,
            left: -effectiveCrop.x * stageW,
            top: -effectiveCrop.y * stageH,
          }}
        >
          <BaseImageStage
            src={imgSrc}
            stageW={stageW}
            orientedBase={orientedBase}
            working={working}
            baseline={baseline}
            onNaturalSize={onBaseSize}
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {inner}
      {/* Before the base natural size is known, load it hidden to report it. */}
      {!orientedBase && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt=""
          className="absolute opacity-0 pointer-events-none"
          onLoad={(e) => onBaseSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      )}
    </div>
  );
}
