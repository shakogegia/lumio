"use client";

import { useCallback, useRef, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export type ConfirmOptions = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Render the confirm button as destructive (red). */
  destructive?: boolean;
  /** Optional secondary button (e.g. "Discard"), shown before Confirm. When set,
   *  confirm() can also resolve "alt" — a distinct outcome from the confirm/cancel
   *  boolean. Omit it for a plain two-button confirm. */
  altLabel?: string;
  /** Render the alt button as destructive (red). */
  altDestructive?: boolean;
  /** Drop the Cancel button (e.g. a forced Discard/Save choice). The dialog can
   *  still be dismissed with Escape, which resolves false. */
  hideCancel?: boolean;
};

/** Confirm: true, Cancel/dismiss: false, the optional middle button: "alt". */
export type ConfirmResult = boolean | "alt";

/**
 * Promise-based confirmation backed by the shadcn AlertDialog (size="sm").
 * Returns a `confirm` function that opens the dialog and resolves true/false,
 * plus the dialog element to render. Keeps call sites imperative:
 *
 *   const { confirm, confirmDialog } = useConfirm();
 *   if (!(await confirm({ title, description }))) return;
 *   ...
 *   return <>{confirmDialog}{rest}</>;
 */
export function useConfirm() {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolveRef = useRef<((value: ConfirmResult) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setOpts(options);
    setOpen(true);
    return new Promise<ConfirmResult>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  // First settle wins and clears the resolver, so the close-triggered
  // onOpenChange(false) that follows an action/cancel click is a no-op.
  // Only drive `open` here — keep `opts` mounted so the content doesn't vanish
  // (collapsing the dialog) mid-exit. Radix unmounts the Content when the
  // close animation finishes, and the next confirm() overwrites `opts`.
  const settle = useCallback((result: ConfirmResult) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setOpen(false);
  }, []);

  const confirmDialog = (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) settle(false);
      }}
    >
      <AlertDialogContent size="sm">
        {opts && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{opts.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {opts.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {!opts.hideCancel && (
                <AlertDialogCancel onClick={() => settle(false)}>
                  {opts.cancelLabel ?? "Cancel"}
                </AlertDialogCancel>
              )}
              {opts.altLabel && (
                <AlertDialogAction
                  variant={opts.altDestructive ? "destructive" : "outline"}
                  onClick={() => settle("alt")}
                >
                  {opts.altLabel}
                </AlertDialogAction>
              )}
              <AlertDialogAction
                // Three buttons in the sm footer's 2-col grid would strand Save
                // half-width on its own row; span it full-width so it anchors the
                // bottom. With two buttons the grid already pairs them cleanly.
                className={
                  opts.altLabel && !opts.hideCancel ? "col-span-2" : undefined
                }
                variant={opts.destructive ? "destructive" : "default"}
                onClick={() => settle(true)}
              >
                {opts.confirmLabel ?? "Confirm"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );

  return { confirm, confirmDialog };
}
