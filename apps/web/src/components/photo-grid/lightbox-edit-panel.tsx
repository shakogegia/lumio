"use client";

import {
  Check,
  FlipHorizontal,
  FlipVertical,
  Loader2,
  RotateCcw,
  RotateCw,
  Undo2,
  Redo2,
} from "lucide-react";
import { hasEdits } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { useEditSession } from "./use-edit-session";
import { useEditKeyboard } from "./use-edit-keyboard";

/** Edit-tab body: rotate/flip controls with undo/redo that drive the lightbox
 *  edit session, plus Apply (persist) and Reset (back to original, on Apply). */
export function LightboxEditPanel() {
  const {
    working,
    dirty,
    applying,
    canUndo,
    canRedo,
    rotateLeft,
    rotateRight,
    flipH,
    flipV,
    reset,
    undo,
    redo,
    apply,
  } = useEditSession();
  useEditKeyboard({ rotateLeft, rotateRight, apply: () => void apply() });
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          disabled={!dirty || applying}
          onClick={() => void apply()}
        >
          {applying ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Check aria-hidden />
          )}
          {applying ? "Applying…" : "Apply"}
          <Kbd className="ml-auto bg-primary-foreground/15 text-primary-foreground">
            ⌘S
          </Kbd>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!hasEdits(working) || applying}
          onClick={reset}
        >
          Reset
        </Button>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Transform</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={rotateLeft}>
            <RotateCcw aria-hidden /> Left
            <Kbd className="ml-auto">[</Kbd>
          </Button>
          <Button variant="outline" size="sm" onClick={rotateRight}>
            <RotateCw aria-hidden /> Right
            <Kbd className="ml-auto">]</Kbd>
          </Button>
          <Button variant="outline" size="sm" onClick={flipH}>
            <FlipHorizontal aria-hidden /> Horizontal
          </Button>
          <Button variant="outline" size="sm" onClick={flipV}>
            <FlipVertical aria-hidden /> Vertical
          </Button>
        </div>
      </div>

      <div className="mt-auto flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!canUndo}
          onClick={undo}
        >
          <Undo2 aria-hidden /> Undo
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!canRedo}
          onClick={redo}
        >
          <Redo2 aria-hidden /> Redo
        </Button>
      </div>
    </div>
  );
}
