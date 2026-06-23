import { createAuthClient } from "better-auth/react";
import { expoClient } from "@better-auth/expo/client";
import { twoFactorClient } from "better-auth/client/plugins";
import * as SecureStore from "expo-secure-store";

// Better Auth's baseURL is fixed at creation, so the client is built per server
// URL (see AuthProvider) rather than as a module singleton.
export function createLumioAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    plugins: [
      expoClient({ scheme: "lumio", storagePrefix: "lumio", storage: SecureStore }),
      twoFactorClient(),
    ],
  });
}

export type LumioAuthClient = ReturnType<typeof createLumioAuthClient>;
