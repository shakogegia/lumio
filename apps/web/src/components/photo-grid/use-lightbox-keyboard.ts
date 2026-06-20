"use client";

import { useEffect, useRef } from "react";
import { createHoldStepper, HOLD_STEP_MS } from "@/lib/hold-key-nav";

export interface LightboxKeys {
  openIndex: number | null;
  total: number | null;
  /** Unsaved edits present — arrow nav prompts to discard (no hold-repeat). */
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  step: (delta: 1 | -1) => void;
  close: () => void;
  /** Wrap a navigation so it prompts when there are unsaved edits. */
  guard: (go: () => void) => void;
  undo: () => void;
  redo: () => void;
}

/**
 * Document-level keyboard handling for the open lightbox: arrow nav with
 * press-and-hold acceleration (guarded for unsaved edits), Escape to close, and
 * undo/redo. Listeners register once; the latest props are read through a single
 * ref so the effect never re-binds.
 */
export function useLightboxKeyboard(keys: LightboxKeys): void {
  const ref = useRef(keys);
  useEffect(() => {
    ref.current = keys;
  });

  useEffect(() => {
    const stepper = createHoldStepper({
      getTarget: () => ({
        canStep: (dir) => {
          const { openIndex, total } = ref.current;
          if (openIndex === null) return false;
          return dir === "next" ? total !== null && openIndex < total - 1 : openIndex > 0;
        },
        step: (dir) => ref.current.step(dir === "next" ? 1 : -1),
      }),
      schedule: (fn) => {
        const id = setInterval(fn, HOLD_STEP_MS);
        return () => clearInterval(id);
      },
    });
    const onKeyDown = (e: KeyboardEvent) => {
      const k = ref.current;
      if (e.key === "Escape") {
        k.guard(() => k.close());
        return;
      }
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      // Undo / redo edits: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, or Ctrl+Y.
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        if (e.shiftKey) {
          if (k.canRedo) {
            e.preventDefault();
            k.redo();
          }
        } else if (k.canUndo) {
          e.preventDefault();
          k.undo();
        }
        return;
      }
      if (e.ctrlKey && !e.metaKey && (e.key === "y" || e.key === "Y")) {
        if (k.canRedo) {
          e.preventDefault();
          k.redo();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const delta: 1 | -1 = e.key === "ArrowRight" ? 1 : -1;
      // With unsaved edits, a single press prompts to discard (no hold-repeat, so
      // the confirm dialog doesn't fire on every interval tick).
      if (k.dirty) {
        if (e.repeat) return;
        k.guard(() => k.step(delta));
        return;
      }
      if (e.repeat) return;
      stepper.press(delta === 1 ? "next" : "prev");
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (ref.current.dirty) return;
      if (e.key === "ArrowLeft") stepper.release("prev");
      else if (e.key === "ArrowRight") stepper.release("next");
    };
    const onBlur = () => stepper.stop();
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      stepper.stop();
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
