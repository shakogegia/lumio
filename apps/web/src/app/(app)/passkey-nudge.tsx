"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

// Once we've shown the nudge (or confirmed the user already has a passkey), we
// never check again on this browser — keeps it a one-time, non-naggy prompt and
// avoids a listUserPasskeys call on every authenticated page load.
const NUDGE_KEY = "lumio:passkey-nudge";

async function addPasskeyFromToast() {
  try {
    const { error } = await authClient.passkey.addPasskey();
    if (error) {
      toast.error(error.message ?? "Could not add a passkey.");
      return;
    }
    toast.success("Passkey added");
  } catch {
    toast.error(
      "Passkey setup was cancelled or isn’t supported on this device.",
    );
  }
}

/**
 * Shows the "set up a passkey" toast with a shadcn action button. Exported so a
 * dev-only sidebar trigger can fire it on demand (bypassing the once-per-browser
 * gate below).
 */
export function showPasskeyNudgeToast() {
  const toastId = toast("Set up a passkey", {
    description:
      "Sign in faster next time with Face ID, Touch ID, or a security key.",
    duration: 12000,
    // Custom shadcn Button instead of sonner's built-in action. A custom node
    // doesn't auto-dismiss, so we dismiss this toast explicitly.
    action: (
      <Button
        size="sm"
        onClick={() => {
          toast.dismiss(toastId);
          void addPasskeyFromToast();
        }}
      >
        <KeyRound />
        Add passkey
      </Button>
    ),
  });
}

/**
 * Mounted in the authenticated app shell. The first time a signed-in user with
 * no passkey loads the app (i.e. right after login) on a WebAuthn-capable
 * browser, it gently suggests adding one. Renders nothing.
 */
export function PasskeyNudge() {
  useEffect(() => {
    if (window.localStorage.getItem(NUDGE_KEY)) return;
    if (typeof PublicKeyCredential === "undefined") return;

    let cancelled = false;
    async function maybeNudge() {
      try {
        const { data, error } = await authClient.passkey.listUserPasskeys();
        if (cancelled || error) return;
        // Either way, don't check again on this browser.
        window.localStorage.setItem(NUDGE_KEY, "done");
        if (data && data.length > 0) return;

        showPasskeyNudgeToast();
      } catch {
        // Network/SDK hiccup — skip silently; the nudge isn't critical.
      }
    }
    void maybeNudge();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
