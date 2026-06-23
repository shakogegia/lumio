import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createLumioAuthClient, type LumioAuthClient } from "@/lib/auth-client";
import { normalizeServerUrl } from "@/lib/api";
import { pingLumioServer } from "@/lib/server-check";
import {
  getStoredServerUrl,
  setStoredServerUrl,
  clearStoredServerUrl,
} from "@/lib/server-url-store";

// Placeholder so a client always exists (Better Auth needs a baseURL and hooks
// must be unconditional). Used only before a real server URL is chosen; its
// session fetch fails harmlessly and we route to `connect` anyway.
const PLACEHOLDER_URL = "http://localhost";

type AuthContextValue = {
  serverUrl: string | null;
  isLoading: boolean; // still loading the stored URL
  session: ReturnType<LumioAuthClient["useSession"]>["data"];
  isPending: boolean; // session resolving
  signIn: LumioAuthClient["signIn"];
  signOut: LumioAuthClient["signOut"]; // end session, keep the server
  connect: (input: string) => Promise<void>;
  disconnect: () => Promise<void>; // end session AND forget the server
  /** Cookie header for authenticating custom (non-Better-Auth) API calls. */
  getCookie: () => string;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // undefined = still loading from storage; null = none stored; string = chosen.
  const [serverUrl, setServerUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    getStoredServerUrl().then((url) => setServerUrl(url ?? null));
  }, []);

  const client = useMemo(
    () => createLumioAuthClient(serverUrl ?? PLACEHOLDER_URL),
    [serverUrl],
  );

  const { data: session, isPending } = client.useSession();

  const value = useMemo<AuthContextValue>(
    () => ({
      serverUrl: serverUrl ?? null,
      isLoading: serverUrl === undefined,
      session,
      isPending,
      signIn: client.signIn,
      signOut: client.signOut,
      getCookie: () => client.getCookie(),
      connect: async (input: string) => {
        const url = normalizeServerUrl(input);
        await pingLumioServer(url);
        await setStoredServerUrl(url);
        setServerUrl(url);
      },
      disconnect: async () => {
        try {
          await client.signOut();
        } catch {
          // server may be unreachable when switching away — ignore.
        }
        await clearStoredServerUrl();
        setServerUrl(null);
      },
    }),
    [serverUrl, session, isPending, client],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
