"use client";
// Client-only. Server code reads sessions via @/lib/server/server-session, not this module.

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { passkeyClient } from "@better-auth/passkey/client";

// No baseURL → defaults to the current origin, so it works in dev and behind
// the Cloudflare tunnel without a public env var.
//
// twoFactorClient adds authClient.twoFactor.* (enable/disable/verifyTotp/
// verifyBackupCode/generateBackupCodes) and makes signIn.email return
// `data.twoFactorRedirect` when a 2FA challenge is required. We intentionally
// do NOT pass onTwoFactorRedirect here — the login form handles that redirect
// with the Next router to avoid a full page reload.
//
// passkeyClient adds authClient.passkey.* (addPasskey/listUserPasskeys/
// updatePasskey/deletePasskey) and authClient.signIn.passkey for WebAuthn
// sign-in. A passkey sign-in resolves to a session directly (no 2FA step).
export const authClient = createAuthClient({
  plugins: [twoFactorClient(), passkeyClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
