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
};

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
  const resolveRef = useRef<((value: boolean) => void) | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    setOpts(options);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
    });
  }, []);

  // First settle wins and clears the resolver, so the close-triggered
  // onOpenChange(false) that follows an action/cancel click is a no-op.
  // Only drive `open` here — keep `opts` mounted so the content doesn't vanish
  // (collapsing the dialog) mid-exit. Radix unmounts the Content when the
  // close animation finishes, and the next confirm() overwrites `opts`.
  const settle = useCallback((result: boolean) => {
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
              <AlertDialogCancel onClick={() => settle(false)}>
                {opts.cancelLabel ?? "Cancel"}
              </AlertDialogCancel>
              <AlertDialogAction
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
