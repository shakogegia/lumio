"use client";

import { RotateCcw, RotateCw, FlipHorizontal, FlipVertical } from "lucide-react";
import { hasEdits, rotateLeft, rotateRight, toggleFlipH, toggleFlipV } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { useEditSession } from "./use-edit-session";

/** Edit-tab body: rotate/flip controls that drive the lightbox edit session,
 *  plus Apply (persist) and Reset (back to original, persisted on Apply). */
export function LightboxEditPanel() {
  const { working, dirty, applying, set, reset, apply } = useEditSession();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={() => set(rotateLeft(working))}>
          <RotateCcw aria-hidden /> Rotate left
        </Button>
        <Button variant="outline" size="sm" onClick={() => set(rotateRight(working))}>
          <RotateCw aria-hidden /> Rotate right
        </Button>
        <Button variant="outline" size="sm" onClick={() => set(toggleFlipH(working))}>
          <FlipHorizontal aria-hidden /> Flip H
        </Button>
        <Button variant="outline" size="sm" onClick={() => set(toggleFlipV(working))}>
          <FlipVertical aria-hidden /> Flip V
        </Button>
      </div>
      <p className="h-4 text-xs text-muted-foreground">{dirty ? "Unsaved changes" : ""}</p>
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" disabled={!dirty || applying} onClick={() => void apply()}>
          {applying ? "Applying…" : "Apply"}
        </Button>
        <Button variant="ghost" size="sm" disabled={!hasEdits(working)} onClick={reset}>
          Reset
        </Button>
      </div>
    </div>
  );
}
