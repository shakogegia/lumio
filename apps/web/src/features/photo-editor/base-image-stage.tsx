"use client";

import { straightenedSize, type PhotoEdits } from "@lumio/shared";

/** Renders the edit-free base with flip + coarse-rotate + straighten applied, as
 *  the O-box (the oriented image, tilted by straighten) holding the base <img>.
 *  Caller wraps this in a POSITIONED stage box of pixel size stageW×stageH (the
 *  O′ straightened bounding box); this fills that box (the O-box is centered in it
 *  via left-1/2/top-1/2). Shared by the crop editor (stage fit whole + overlay)
 *  and the edited-result preview (stage clipped to the crop). */
export function BaseImageStage({
  src,
  stageW,
  orientedBase,
  working,
  onLoad,
}: {
  src: string;
  stageW: number;
  orientedBase: { w: number; h: number };
  working: PhotoEdits;
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}) {
  const theta = working.straighten ?? 0;
  const sx = working.flipH ? -1 : 1;
  const sy = working.flipV ? -1 : 1;
  const { w: wp } = straightenedSize(orientedBase.w, orientedBase.h, theta);
  const k = wp === 0 ? 0 : stageW / wp; // uniform O′-unit → px (stageW/wp === stageH/hp)
  const oW = orientedBase.w * k;
  const oH = orientedBase.h * k;
  const swap = working.rotate === 90 || working.rotate === 270;
  return (
    <div
      className="absolute left-1/2 top-1/2"
      style={{ width: oW, height: oH, transform: `translate(-50%, -50%) rotate(${theta}deg)` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={onLoad}
        className="absolute left-1/2 top-1/2 max-w-none select-none"
        style={{
          width: swap ? oH : oW,
          height: swap ? oW : oH,
          transform: `translate(-50%, -50%) rotate(${working.rotate}deg) scaleX(${sx}) scaleY(${sy})`,
          transformOrigin: "center center",
        }}
      />
    </div>
  );
}
