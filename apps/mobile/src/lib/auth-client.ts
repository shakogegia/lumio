import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { twoFactorClient } from "better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";
import { resolveApiBaseUrl } from "./api";

// Bearer-token auth for native: the Expo client stores the session token in
// expo-secure-store and attaches it to requests automatically. The backend's
// Better Auth instance must have the matching expo() server plugin enabled.
//
// twoFactorClient lets signIn.email surface `data.twoFactorRedirect` when the
// account has 2FA enabled — we detect that and show a message (full TOTP UI is
// a later milestone) instead of silently failing.
export const authClient = createAuthClient({
  baseURL: resolveApiBaseUrl(),
  plugins: [
    expoClient({
      scheme: "lumio",
      storagePrefix: "lumio",
      storage: SecureStore,
    }),
    twoFactorClient(),
  ],
});

export const { signIn, signOut, useSession } = authClient;
