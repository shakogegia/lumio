"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";

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
    toast.success("Passkey added — you can use it to sign in next time.");
  } catch {
    toast.error(
      "Passkey setup was cancelled or isn’t supported on this device.",
    );
  }
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

        toast("Set up a passkey", {
          description:
            "Sign in faster next time with Face ID, Touch ID, or a security key.",
          duration: 12000,
          action: {
            label: "Add passkey",
            onClick: () => void addPasskeyFromToast(),
          },
        });
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
