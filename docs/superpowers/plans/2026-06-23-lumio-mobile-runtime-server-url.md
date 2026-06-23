# Lumio Mobile — Runtime Server URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Make the shared mobile app ask each user for their self-hosted Lumio server URL at runtime (validate + persist), instead of relying on the build-time `EXPO_PUBLIC_API_URL`.

**Architecture:** A `connect` screen captures + validates the URL (ping `/api/auth/ok`) and stores it in `expo-secure-store`. The Better Auth client becomes a factory built by an `AuthProvider` once the URL is known; the provider exposes session + auth actions via `useAuth()`. `EXPO_PUBLIC_API_URL` remains only as a dev prefill.

**Tech Stack:** Expo SDK 56, expo-router 6, better-auth 1.6.19 + @better-auth/expo, expo-secure-store, vitest.

**Context for the implementer:**
- App at `apps/mobile`, `src/` layout (`@/*` → `./src/*`), branch `gego/expo-mobile-app-init`. Commit on that branch; no new branches/worktrees.
- Existing files this plan changes: `src/lib/api.ts` (+test), `src/lib/auth-client.ts`, `src/app/_layout.tsx`, `src/app/login.tsx`, `src/app/index.tsx`, `.env.example`, `README.md`. New: `src/lib/server-url-store.ts`, `src/lib/server-check.ts`, `src/lib/auth-context.tsx`, `src/app/connect.tsx`. Repo: `Makefile`, `scripts/conductor/run.sh`.
- The monorepo uses `nodeLinker: hoisted` (in `pnpm-workspace.yaml`) — required for the Expo bundle. After any dep change run a bundle smoke (`npx expo export --platform ios`).
- React Compiler is ON (SDK 56): no prop/state mutation; hooks unconditional and in stable order.

---

## Task R1: Repurpose the URL helper as a pure validator (TDD)

**Files:** `src/lib/api.ts`, `src/lib/api.test.ts`

- [ ] **Step 1: Update the tests first** — `src/lib/api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeServerUrl } from "./api";

describe("normalizeServerUrl", () => {
  it("strips a trailing slash", () => {
    expect(normalizeServerUrl("http://localhost:3000/")).toBe("http://localhost:3000");
  });
  it("passes through a clean URL", () => {
    expect(normalizeServerUrl("https://photos.example.com")).toBe("https://photos.example.com");
  });
  it("trims surrounding whitespace", () => {
    expect(normalizeServerUrl("  http://192.168.1.50:3000  ")).toBe("http://192.168.1.50:3000");
  });
  it("throws when empty", () => {
    expect(() => normalizeServerUrl("")).toThrow(/enter .*server/i);
  });
  it("throws when blank", () => {
    expect(() => normalizeServerUrl("   ")).toThrow(/enter .*server/i);
  });
  it("throws when not http(s)", () => {
    expect(() => normalizeServerUrl("ftp://nope")).toThrow(/http/i);
  });
});
```

- [ ] **Step 2: Run tests, verify they FAIL** (`normalizeServerUrl` undefined): `pnpm --filter @lumio/mobile test`

- [ ] **Step 3: Implement** — replace `src/lib/api.ts` contents:

```ts
/**
 * Validate and normalize a user-entered Lumio server URL.
 *
 * Returns the URL with surrounding whitespace and any trailing slash removed.
 * Throws a user-facing message when the input is empty or not an http(s) URL.
 */
export function normalizeServerUrl(input: string): string {
  const value = input.trim();
  if (!value) {
    throw new Error("Please enter your Lumio server URL.");
  }
  if (!/^https?:\/\//i.test(value)) {
    throw new Error("Server URL must start with http:// or https://");
  }
  return value.replace(/\/+$/, "");
}
```

- [ ] **Step 4: Run tests, verify PASS.**
- [ ] **Step 5: Commit** — `git add apps/mobile/src/lib/api.ts apps/mobile/src/lib/api.test.ts && git commit -m "refactor(mobile): normalizeServerUrl validator for user-entered URL"`

---

## Task R2: Server URL storage + reachability check

**Files:** `src/lib/server-url-store.ts`, `src/lib/server-check.ts`

- [ ] **Step 1: Storage wrapper** — `src/lib/server-url-store.ts`:

```ts
import * as SecureStore from "expo-secure-store";

// The chosen server URL is persisted so the app reconnects on next launch.
// Not secret, but SecureStore is already a dependency and works for this.
const KEY = "lumio.serverUrl";

export async function getStoredServerUrl(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function setStoredServerUrl(url: string): Promise<void> {
  await SecureStore.setItemAsync(KEY, url);
}

export async function clearStoredServerUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}
```

- [ ] **Step 2: Reachability/identity check** — `src/lib/server-check.ts`:

```ts
/**
 * Confirm a base URL points at a reachable Lumio (Better Auth) server.
 * Better Auth exposes GET /api/auth/ok -> { ok: true }. Throws a user-facing
 * message on network failure or a non-Lumio response.
 */
export async function pingLumioServer(baseURL: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${baseURL}/api/auth/ok`, {
      method: "GET",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new Error("Could not reach that server. Check the URL and your network.");
  }
  if (!res.ok) {
    throw new Error(`That server responded with ${res.status}. Is the URL correct?`);
  }
  // Best-effort identity check; if the body isn't the expected shape we still
  // accept a 200 from /api/auth/ok (older servers may differ).
  try {
    const body = (await res.json()) as { ok?: boolean };
    if (body && body.ok === false) {
      throw new Error("That doesn't look like a Lumio server.");
    }
  } catch {
    // non-JSON 200 — accept.
  }
}
```

> **Implementer:** before finalizing, verify the endpoint against the running dev backend: `curl -s http://localhost:3000/api/auth/ok` (start it with `pnpm db:up && pnpm dev` if needed). If `/api/auth/ok` is NOT present in better-auth 1.6.19 (404), switch the path to `/api/auth/get-session` (a 200 there also confirms a valid Better Auth server) and note it in your report.

- [ ] **Step 3: Type-check** `cd apps/mobile && npx tsc --noEmit` (expect clean — note `connect`/context arrive in later tasks, no `/`-route regressions here).
- [ ] **Step 4: Commit** — `git add apps/mobile/src/lib/server-url-store.ts apps/mobile/src/lib/server-check.ts && git commit -m "feat(mobile): server URL storage + reachability check"`

---

## Task R3: Auth client factory + AuthProvider context

**Files:** `src/lib/auth-client.ts` (rewrite), `src/lib/auth-context.tsx` (new)

- [ ] **Step 1: Client factory** — replace `src/lib/auth-client.ts`:

```ts
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
```

- [ ] **Step 2: Provider + hook** — `src/lib/auth-context.tsx`:

```tsx
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createLumioAuthClient, type LumioAuthClient } from "./auth-client";
import { normalizeServerUrl } from "./api";
import { pingLumioServer } from "./server-check";
import {
  getStoredServerUrl,
  setStoredServerUrl,
  clearStoredServerUrl,
} from "./server-url-store";

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
  connect: (input: string) => Promise<void>;
  disconnect: () => Promise<void>;
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
```

- [ ] **Step 3: Type-check** `cd apps/mobile && npx tsc --noEmit`. If the `session` type expression is awkward, you may type `session` as `LumioAuthClient` session data via `ReturnType<...>["data"]` (as shown) or fall back to the inferred type — keep it type-safe and explain any change.
- [ ] **Step 4: Commit** — `git add apps/mobile/src/lib/auth-client.ts apps/mobile/src/lib/auth-context.tsx && git commit -m "feat(mobile): auth client factory + AuthProvider (runtime baseURL)"`

---

## Task R4: Screens + layout wiring

**Files:** `src/app/_layout.tsx`, `src/app/connect.tsx` (new), `src/app/login.tsx` (rewrite), `src/app/index.tsx` (rewrite)

- [ ] **Step 1: Root layout wraps AuthProvider** — `src/app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { AuthProvider } from "../lib/auth-context";

export default function RootLayout() {
  return (
    <AuthProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </AuthProvider>
  );
}
```

- [ ] **Step 2: Connect screen** — `src/app/connect.tsx`:

```tsx
import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "../lib/auth-context";

export default function Connect() {
  const { serverUrl, isLoading } = useAuth();
  const { connect } = useAuth();
  // Dev convenience: pre-fill from EXPO_PUBLIC_API_URL when present.
  const [url, setUrl] = useState(process.env.EXPO_PUBLIC_API_URL ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) {
    return (
      <View style={styles.center}><ActivityIndicator /></View>
    );
  }
  if (serverUrl) return <Redirect href="/login" />;

  const handleConnect = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await connect(url);
      router.replace("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Connect to Lumio</Text>
      <Text style={styles.sub}>Enter the address of your Lumio server.</Text>
      <TextInput
        style={styles.input}
        placeholder="https://photos.example.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        value={url}
        onChangeText={setUrl}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={handleConnect} disabled={submitting || !url}>
        <Text style={styles.buttonText}>{submitting ? "Connecting…" : "Connect"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: "700", textAlign: "center" },
  sub: { fontSize: 15, color: "#555", textAlign: "center", marginBottom: 8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, fontSize: 16 },
  button: { backgroundColor: "#111", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#c00" },
});
```

- [ ] **Step 3: Login screen** — rewrite `src/app/login.tsx` to use context + guards + "Change server":

```tsx
import { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "../lib/auth-context";

export default function Login() {
  const { serverUrl, isLoading, session, signIn, disconnect } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (isLoading) return <View style={styles.center}><ActivityIndicator /></View>;
  if (!serverUrl) return <Redirect href="/connect" />;
  if (session) return <Redirect href="/" />;

  const handleLogin = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: authError } = await signIn.email({ email: email.trim(), password });
      if (authError) {
        setError(authError.message ?? "Sign in failed. Check your credentials.");
        return;
      }
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        setError("Two-factor auth isn't supported in the app yet.");
        return;
      }
      router.replace("/");
    } catch {
      setError("Could not reach the server. Check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleChangeServer = async () => {
    await disconnect();
    router.replace("/connect");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lumio</Text>
      <Text style={styles.server}>{serverUrl}</Text>
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={handleLogin} disabled={submitting || !email || !password}>
        <Text style={styles.buttonText}>{submitting ? "Signing in…" : "Sign in"}</Text>
      </Pressable>
      <Pressable onPress={handleChangeServer}>
        <Text style={styles.link}>Change server</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: "700", textAlign: "center" },
  server: { fontSize: 13, color: "#888", textAlign: "center", marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 8, padding: 12, fontSize: 16 },
  button: { backgroundColor: "#111", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { color: "#2563eb", textAlign: "center", marginTop: 12, fontSize: 14 },
  error: { color: "#c00" },
});
```

- [ ] **Step 4: Home screen** — rewrite `src/app/index.tsx`:

```tsx
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Redirect, router } from "expo-router";
import { useAuth } from "../lib/auth-context";

export default function Home() {
  const { serverUrl, isLoading, session, isPending, disconnect } = useAuth();

  if (isLoading || isPending) return <View style={styles.center}><ActivityIndicator /></View>;
  if (!serverUrl) return <Redirect href="/connect" />;
  if (!session) return <Redirect href="/login" />;

  const handleChangeServer = async () => {
    await disconnect();
    router.replace("/connect");
  };

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>You're signed in</Text>
      <Text style={styles.sub}>{session.user.email}</Text>
      <Text style={styles.server}>{serverUrl}</Text>
      <Pressable style={styles.button} onPress={() => disconnect()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
      <Pressable onPress={handleChangeServer}>
        <Text style={styles.link}>Change server</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, justifyContent: "center", alignItems: "center", gap: 8, padding: 24 },
  heading: { fontSize: 24, fontWeight: "700" },
  sub: { fontSize: 16, color: "#555" },
  server: { fontSize: 13, color: "#888", marginBottom: 12 },
  button: { backgroundColor: "#111", borderRadius: 8, paddingVertical: 12, paddingHorizontal: 20, marginTop: 8 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  link: { color: "#2563eb", marginTop: 12, fontSize: 14 },
});
```

> Note: "Sign out" here calls `disconnect()` (ends the session AND returns to `connect`) to keep the skeleton simple — a session-only sign-out that returns to `login` for the same server can be added later. Keep both `disconnect` calls; the home screen's two actions are intentionally similar for now.

- [ ] **Step 5: Type-check** `cd apps/mobile && npx tsc --noEmit`. The new `/connect` route must resolve in typed-routes; if stale, regenerate `.expo/types` by briefly running `npx expo start` (backgrounded + killed; do NOT commit `.expo/`). Must end CLEAN.
- [ ] **Step 6: Commit** — `git add apps/mobile/src/app/_layout.tsx apps/mobile/src/app/connect.tsx apps/mobile/src/app/login.tsx apps/mobile/src/app/index.tsx && git commit -m "feat(mobile): runtime server-connect flow + change-server"`

---

## Task R5: Dev plumbing (env example, README, Makefile, Conductor)

**Files:** `apps/mobile/.env.example`, `apps/mobile/README.md`, `Makefile`, `scripts/conductor/run.sh`

- [ ] **Step 1: `.env.example`** — clarify it's a dev-only prefill:

```bash
# DEV ONLY — pre-fills the "Connect to Lumio" screen so you don't retype the URL.
# In a real (shared) build the user enters their own server URL in-app; this var
# is not required.
# - iOS Simulator: http://localhost:3000 (shares the host network)
# - Android emulator: http://10.0.2.2:3000
# - Physical device (Expo Go): your machine's LAN IP, e.g. http://192.168.1.50:3000
EXPO_PUBLIC_API_URL="http://localhost:3000"
```

- [ ] **Step 2: README** — update the Notes section so it states the app asks for the server URL at runtime (the `connect` screen), and `EXPO_PUBLIC_API_URL` only pre-fills it in dev. Replace the bullet that described the env var as the backend pointer with:

```markdown
- On first launch the app asks for your Lumio **server URL** (the `connect`
  screen) and remembers it (in `expo-secure-store`). Use **Change server** to
  switch. `EXPO_PUBLIC_API_URL` (in `.env`) only pre-fills that field in dev.
```

Keep the other README notes (bearer auth, 2FA, typed-routes, future milestones).

- [ ] **Step 3: Makefile** — add an `ios` target and mark it PHONY. Add `ios` to the `.PHONY` line, and add near the `dev` target:

```make
# Launch the mobile app in the iOS Simulator (Expo Go; needs Xcode + a backend).
ios:
	cd apps/mobile && npx expo start --ios
```

- [ ] **Step 4: Conductor `run.sh`** — write the mobile dev prefill once `$PORT` is known. Insert AFTER the `export PORT=...` line and BEFORE `pnpm db:up` (so it runs every dev start). Use the same grep -v/.tmp/mv idempotent pattern as setup.sh:

```bash
# Mobile dev convenience: pre-fill the Expo app's "Connect" screen with this
# workspace's web URL. The iOS Simulator reaches the host's localhost; the
# portless .localhost:1355 subdomain can't be TLS-trusted from the simulator,
# so we use the direct port. apps/mobile/.env is gitignored + per-workspace.
mobile_env="$(dirname "$0")/../../apps/mobile/.env"
if [ -f "$(dirname "$0")/../../apps/mobile/package.json" ]; then
  { [ -f "$mobile_env" ] && grep -v '^EXPO_PUBLIC_API_URL=' "$mobile_env" || true; } > "$mobile_env.tmp"
  printf 'EXPO_PUBLIC_API_URL="http://localhost:%s"\n' "$PORT" >> "$mobile_env.tmp"
  mv "$mobile_env.tmp" "$mobile_env"
  echo "==> wrote apps/mobile/.env EXPO_PUBLIC_API_URL=http://localhost:$PORT"
fi
```

> Implementer: verify the relative path resolves (run.sh lives in `scripts/conductor/`, so `../../` from there is the repo root). Test by sourcing the path math, e.g. `bash -c 'cd scripts/conductor && ls ../../apps/mobile/package.json'` → should exist.

- [ ] **Step 5: Commit** — `git add apps/mobile/.env.example apps/mobile/README.md Makefile scripts/conductor/run.sh && git commit -m "chore(mobile): dev prefill (.env via run.sh), make ios, runtime-URL docs"`

---

## Task R6: Verify

- [ ] **Bundle smoke:** `cd apps/mobile && npx expo export --platform ios --output-dir /tmp/lumio-export-2` → must succeed (all routes incl. `connect` bundle).
- [ ] **Unit tests:** `pnpm --filter @lumio/mobile test` (normalizeServerUrl green).
- [ ] **Web regression:** `pnpm --filter @lumio/web test` → still 422 (backend untouched, but confirm).
- [ ] **tsc:** `cd apps/mobile && npx tsc --noEmit` clean.

## Self-review notes
- Spec AMENDMENT 2 coverage: connect screen + validation (R2/R4), SecureStore persistence (R2), factory+provider runtime baseURL (R3), change-server/disconnect (R3/R4), normalizeServerUrl repurpose (R1), EXPO_PUBLIC_API_URL as dev prefill (R4 connect default + R5), make ios + run.sh prefill (R5). All mapped.
- Placeholder-client tradeoff (a harmless localhost session fetch before a URL is chosen) is documented in `auth-context.tsx`.
- Out-of-scope per spec: per-server token isolation, multi-server history.
