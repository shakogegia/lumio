# Lumio Mobile — Auth Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an Expo app at `apps/mobile` that logs in against the existing Lumio Better Auth backend and persists the session — no photo browsing yet.

**Architecture:** Expo (SDK 55, TypeScript, Expo Router) inside the existing pnpm monorepo. Auth uses Better Auth's official Expo plugin: an `expoClient` on the device storing the session token in `expo-secure-store`, plus a small additive `expo()` plugin on the existing Next backend (`apps/web/src/lib/auth.ts`). Two screens: a login form and a protected placeholder home, with session-based redirects.

**Tech Stack:** Expo SDK 55 / React Native 0.83 / React 19.2, Expo Router, `better-auth@1.6.19`, `@better-auth/expo@1.6.19`, `expo-secure-store`, `expo-network`, vitest (for the one pure helper).

---

## Context for the implementer (read first)

- **Monorepo:** pnpm workspaces; `pnpm-workspace.yaml` already globs `apps/*`, so `apps/mobile` joins automatically. Node 24. Root `package.json` has `vitest` as a devDependency; tests run with vitest.
- **Backend already exists and is unchanged in behavior.** The Next web app at `apps/web` exposes Better Auth at `/api/auth/[...all]` and runs on `http://localhost:3000` in dev (`pnpm dev` / `make dev`; needs Postgres up via `pnpm db:up`). The single admin account is created via the web `/setup` page; signup is closed after that.
- **Current server auth config** lives at `apps/web/src/lib/auth.ts`. It already builds `trustedOrigins` from `BETTER_AUTH_URL` + `BETTER_AUTH_TRUSTED_ORIGINS`, and uses the `twoFactor()` plugin. We add the Expo plugin and the app scheme to it.
- **Why bearer instead of cookies:** the Expo plugin makes the device store the session token in secure storage and attach it automatically; web cookies are untouched. Plain `http://localhost:3000` is fine for the bearer flow (no Secure-cookie constraint).
- **Run target for verification:** Expo Go on the iOS Simulator (or the `w` web target). Expo Go ships `expo-secure-store` and `expo-network`, so **no native/dev build is required** for this milestone — this sidesteps React-Native autolinking under pnpm.
- **TDD note:** scaffolding, Metro config, and native screens are verified by running the app (the right verification for that layer). The one piece of pure logic — resolving/validating the API base URL — is built test-first with vitest (Task 5).
- **App scheme:** `lumio`.

## File structure (what gets created / modified)

Created under `apps/mobile/`:
- `package.json` — workspace package `@lumio/mobile` (Expo manages RN/React versions).
- `app.json` — Expo config; `scheme: "lumio"`.
- `metro.config.js` — monorepo-aware Metro resolution.
- `tsconfig.json` — Expo TS config (from template).
- `babel.config.js` — from template (`babel-preset-expo`).
- `lib/api.ts` — `resolveApiBaseUrl()` pure helper.
- `lib/api.test.ts` — vitest test for the helper.
- `lib/auth-client.ts` — Better Auth Expo client.
- `app/_layout.tsx` — root Stack layout.
- `app/index.tsx` — protected placeholder home.
- `app/login.tsx` — email/password login screen.
- `vitest.config.ts` — scoped to `lib/**/*.test.ts` (pure modules only).
- `.env.example` — documents `EXPO_PUBLIC_API_URL`.
- `.gitignore` — Expo default + `.env`.

Modified:
- `apps/web/src/lib/auth.ts` — add `expo()` plugin + scheme to `trustedOrigins`.
- `apps/web/package.json` — add `@better-auth/expo` dependency.

---

## Task 1: Scaffold the Expo app at `apps/mobile`

**Files:**
- Create: `apps/mobile/**` (Expo default template)

- [ ] **Step 1: Create the app from the default template**

From the repo root (`/Users/gego/conductor/workspaces/lumio/adelaide`):

```bash
pnpm create expo-app@latest apps/mobile --template default --no-install
```

`--no-install` is important: we let the **root** pnpm install run in Task 2 so the workspace resolves correctly. The `default` template is TypeScript + Expo Router and already includes `expo-router`, `expo-linking`, `expo-constants`, `expo-web-browser`.

- [ ] **Step 2: Rename the package for the workspace**

Edit `apps/mobile/package.json` — set the name and mark private:

```json
{
  "name": "@lumio/mobile",
  "private": true
}
```

(Leave the Expo-generated `scripts`, `dependencies`, and `devDependencies` as-is.)

- [ ] **Step 3: Set the app scheme and identity**

Edit `apps/mobile/app.json` so the `expo` block has these values (keep the rest the template generated):

```json
{
  "expo": {
    "name": "Lumio",
    "slug": "lumio-mobile",
    "scheme": "lumio"
  }
}
```

- [ ] **Step 4: Remove example screens we don't need**

The default template ships a tabs example. Delete it so we start clean:

```bash
rm -rf apps/mobile/app/(tabs) apps/mobile/app/+not-found.tsx apps/mobile/components apps/mobile/constants apps/mobile/hooks apps/mobile/scripts
```

(If any of those paths don't exist in the generated template, that's fine — `rm -rf` is a no-op for missing paths. We recreate `app/` files in Tasks 7–8.)

- [ ] **Step 5: Append `.env` to the app gitignore**

Edit `apps/mobile/.gitignore` and add a line:

```
.env
```

- [ ] **Step 6: Commit**

```bash
git add apps/mobile
git commit -m "feat(mobile): scaffold Expo app at apps/mobile"
```

---

## Task 2: Wire Metro for the monorepo and install

**Files:**
- Create: `apps/mobile/metro.config.js`

- [ ] **Step 1: Write the monorepo Metro config**

Create `apps/mobile/metro.config.js`:

```js
// Learn more: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so Metro picks up workspace packages.
config.watchFolders = [monorepoRoot];

// 2. Resolve modules from the app first, then the workspace root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

// 3. Only look in the paths above (don't walk up the tree ambiguously).
config.resolver.disableHierarchicalLookup = true;

// Do NOT disable package exports — Better Auth resolves its modules via exports.
module.exports = config;
```

- [ ] **Step 2: Install the workspace from the root**

```bash
pnpm install
```

Expected: completes without errors; `apps/mobile/node_modules` is populated (symlinks into the pnpm store).

- [ ] **Step 3: Verify the app boots under Metro**

```bash
cd apps/mobile && npx expo start --clear
```

Expected: Metro starts and prints the QR / dev menu without a bundling error. Press `w` to confirm the web bundle builds (a blank/`index` route is fine at this point — we replace screens later). Then stop it (Ctrl+C) and `cd` back to the repo root.

> **Troubleshooting (pnpm + Metro):** if Metro reports it cannot resolve a transitive module, add `node-linker=hoisted` to a repo-root `.npmrc`, run `pnpm install` again, then `npx expo start --clear`. This matches Expo's official monorepo guidance for pnpm. Only do this if the default path above fails — it changes linking repo-wide.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/metro.config.js pnpm-lock.yaml
git commit -m "build(mobile): monorepo-aware Metro config"
```

---

## Task 3: Install auth dependencies in the mobile app

**Files:**
- Modify: `apps/mobile/package.json` (via `expo install` / `pnpm add`)

- [ ] **Step 1: Add Expo-managed native modules (version-matched to the SDK)**

```bash
cd apps/mobile && npx expo install expo-secure-store expo-network && cd ../..
```

`expo install` pins versions compatible with the installed Expo SDK.

- [ ] **Step 2: Add the Better Auth packages (pinned to the backend version)**

```bash
pnpm --filter @lumio/mobile add better-auth@1.6.19 @better-auth/expo@1.6.19
```

Pinning to `1.6.19` keeps the client in lockstep with the server's `better-auth@1.6.19`.

- [ ] **Step 3: Verify install + bundle still resolve**

```bash
cd apps/mobile && npx expo start --clear
```

Expected: Metro bundles without "unable to resolve" errors for the new packages. Stop it and return to the repo root.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/package.json pnpm-lock.yaml
git commit -m "build(mobile): add better-auth expo client + secure-store deps"
```

---

## Task 4: Add the Expo plugin to the backend

**Files:**
- Modify: `apps/web/src/lib/auth.ts`
- Modify: `apps/web/package.json` (add `@better-auth/expo`)
- Test: `apps/web` existing vitest suite (regression)

- [ ] **Step 1: Add the server-side package**

```bash
pnpm --filter @lumio/web add @better-auth/expo@1.6.19
```

- [ ] **Step 2: Import the plugin and extend trusted origins**

Edit `apps/web/src/lib/auth.ts`.

Add the import near the other Better Auth imports (after the `twoFactor` import line):

```ts
import { expo } from "@better-auth/expo";
```

Replace the existing `trustedOrigins` construction:

```ts
const trustedOrigins = [
  ...new Set([...(baseURL ? [baseURL] : []), ...extraTrustedOrigins]),
];
```

with one that also trusts the mobile scheme (and Expo's dev `exp://` URLs in development):

```ts
// The mobile app authenticates from the `lumio://` scheme; in dev, Expo Go
// serves the app over `exp://<lan-ip>:<port>`. Trust both so Better Auth's
// origin check accepts requests from the Expo client.
const mobileOrigins = [
  "lumio://",
  "lumio://*",
  ...(process.env.NODE_ENV === "development" ? ["exp://", "exp://**"] : []),
];

const trustedOrigins = [
  ...new Set([
    ...(baseURL ? [baseURL] : []),
    ...extraTrustedOrigins,
    ...mobileOrigins,
  ]),
];
```

- [ ] **Step 3: Register the plugin**

In the `betterAuth({ ... })` call, change the plugins line:

```ts
  plugins: [twoFactor()],
```

to:

```ts
  plugins: [twoFactor(), expo()],
```

- [ ] **Step 4: Run the web test suite (regression)**

```bash
pnpm --filter @lumio/web test
```

Expected: PASS — the existing auth/with-auth/auth-paths tests still pass; adding the plugin and origins does not break them.

- [ ] **Step 5: Manually verify web login still works**

With Postgres up (`pnpm db:up`) and the dev server running (`pnpm dev`), log in through the web `/login` page as before.
Expected: web login still succeeds (the Expo plugin is additive and does not affect the cookie flow).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/auth.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(auth): enable Better Auth Expo plugin + mobile trusted origins"
```

---

## Task 5: API base-URL helper (test-first)

**Files:**
- Create: `apps/mobile/vitest.config.ts`
- Create: `apps/mobile/lib/api.test.ts`
- Create: `apps/mobile/lib/api.ts`

- [ ] **Step 1: Add a scoped vitest config**

Create `apps/mobile/vitest.config.ts` (only runs pure `lib` modules — no React Native transform):

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
```

Add a `test` script to `apps/mobile/package.json` `scripts`:

```json
"test": "vitest run"
```

And add vitest as a devDependency:

```bash
pnpm --filter @lumio/mobile add -D vitest@^2
```

- [ ] **Step 2: Write the failing test**

Create `apps/mobile/lib/api.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveApiBaseUrl } from "./api";

describe("resolveApiBaseUrl", () => {
  it("returns the configured URL without a trailing slash", () => {
    expect(resolveApiBaseUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000",
    );
  });

  it("passes through a URL that has no trailing slash", () => {
    expect(resolveApiBaseUrl("http://192.168.1.50:3000")).toBe(
      "http://192.168.1.50:3000",
    );
  });

  it("throws a clear error when the URL is missing", () => {
    expect(() => resolveApiBaseUrl(undefined)).toThrow(
      /EXPO_PUBLIC_API_URL/,
    );
  });

  it("throws when the URL is blank", () => {
    expect(() => resolveApiBaseUrl("   ")).toThrow(/EXPO_PUBLIC_API_URL/);
  });

  it("throws when the URL is not http(s)", () => {
    expect(() => resolveApiBaseUrl("ftp://nope")).toThrow(/http/);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @lumio/mobile test
```

Expected: FAIL — `resolveApiBaseUrl` is not defined / module `./api` not found.

- [ ] **Step 4: Implement the helper**

Create `apps/mobile/lib/api.ts`:

```ts
/**
 * Resolve and validate the Lumio backend base URL for the mobile app.
 *
 * Reads from EXPO_PUBLIC_API_URL (see .env.example). Fails fast with a clear
 * message so a misconfigured device doesn't produce confusing network errors.
 * Returns the URL with any trailing slash removed.
 */
export function resolveApiBaseUrl(
  raw: string | undefined = process.env.EXPO_PUBLIC_API_URL,
): string {
  const value = raw?.trim();
  if (!value) {
    throw new Error(
      "EXPO_PUBLIC_API_URL is not set. Copy apps/mobile/.env.example to " +
        "apps/mobile/.env and point it at your running Lumio backend.",
    );
  }
  if (!/^https?:\/\//.test(value)) {
    throw new Error(
      `EXPO_PUBLIC_API_URL must be an http(s) URL, got: ${value}`,
    );
  }
  return value.replace(/\/+$/, "");
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @lumio/mobile test
```

Expected: PASS — all five cases green.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/lib/api.ts apps/mobile/lib/api.test.ts apps/mobile/vitest.config.ts apps/mobile/package.json pnpm-lock.yaml
git commit -m "feat(mobile): validated API base-URL resolver"
```

---

## Task 6: Better Auth Expo client

**Files:**
- Create: `apps/mobile/lib/auth-client.ts`

- [ ] **Step 1: Write the auth client**

Create `apps/mobile/lib/auth-client.ts`:

```ts
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
```

- [ ] **Step 2: Type-check**

```bash
cd apps/mobile && npx tsc --noEmit && cd ../..
```

Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/lib/auth-client.ts
git commit -m "feat(mobile): Better Auth Expo client (secure-store bearer auth)"
```

---

## Task 7: Login screen

**Files:**
- Create: `apps/mobile/app/login.tsx`

- [ ] **Step 1: Write the login screen**

Create `apps/mobile/app/login.tsx`:

```tsx
import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { Redirect, router } from "expo-router";
import { signIn, useSession } from "../lib/auth-client";

export default function Login() {
  const { data: session, isPending } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already authenticated → go home.
  if (session) return <Redirect href="/" />;

  const handleLogin = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const { data, error: authError } = await signIn.email({
        email: email.trim(),
        password,
      });
      if (authError) {
        setError(authError.message ?? "Sign in failed. Check your credentials.");
        return;
      }
      // 2FA is enabled on the backend; a TOTP-protected account returns a
      // redirect instead of a session. Full TOTP entry is a later milestone.
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        setError("Two-factor auth isn't supported in the app yet.");
        return;
      }
      router.replace("/");
    } catch {
      setError("Could not reach the server. Check EXPO_PUBLIC_API_URL.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Lumio</Text>
      {isPending ? (
        <ActivityIndicator />
      ) : (
        <>
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
          <Pressable
            style={styles.button}
            onPress={handleLogin}
            disabled={submitting || !email || !password}
          >
            <Text style={styles.buttonText}>
              {submitting ? "Signing in…" : "Sign in"}
            </Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 12 },
  title: { fontSize: 32, fontWeight: "700", textAlign: "center", marginBottom: 16 },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#111",
    borderRadius: 8,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#c00" },
});
```

- [ ] **Step 2: Type-check**

```bash
cd apps/mobile && npx tsc --noEmit && cd ../..
```

Expected: no type errors. (Screen render is verified end-to-end in Task 10.)

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/app/login.tsx
git commit -m "feat(mobile): email/password login screen"
```

---

## Task 8: Root layout + protected home

**Files:**
- Create: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/index.tsx`

- [ ] **Step 1: Write the root layout**

Create `apps/mobile/app/_layout.tsx`:

```tsx
import { Stack } from "expo-router";

export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

- [ ] **Step 2: Write the protected home screen**

Create `apps/mobile/app/index.tsx`:

```tsx
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { Redirect } from "expo-router";
import { signOut, useSession } from "../lib/auth-client";

export default function Home() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  // Not authenticated → login.
  if (!session) return <Redirect href="/login" />;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>You're signed in</Text>
      <Text style={styles.sub}>{session.user.email}</Text>
      <Pressable style={styles.button} onPress={() => signOut()}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  container: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, padding: 24 },
  heading: { fontSize: 24, fontWeight: "700" },
  sub: { fontSize: 16, color: "#555" },
  button: {
    backgroundColor: "#111",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 16,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
```

- [ ] **Step 3: Type-check**

```bash
cd apps/mobile && npx tsc --noEmit && cd ../..
```

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/app/_layout.tsx apps/mobile/app/index.tsx
git commit -m "feat(mobile): root layout + protected home with sign-out"
```

---

## Task 9: Env example + docs

**Files:**
- Create: `apps/mobile/.env.example`
- Create: `apps/mobile/README.md`

- [ ] **Step 1: Write the env example**

Create `apps/mobile/.env.example`:

```bash
# Base URL of the running Lumio backend (the Next web app).
# - iOS Simulator: http://localhost:3000 works (shares the host network).
# - Android emulator: use http://10.0.2.2:3000
# - Physical device (Expo Go): use your machine's LAN IP, e.g. http://192.168.1.50:3000
#   and make sure that origin is reachable from the phone.
EXPO_PUBLIC_API_URL="http://localhost:3000"
```

- [ ] **Step 2: Write a short README**

Create `apps/mobile/README.md`:

```markdown
# Lumio Mobile

Expo (SDK 55) client for Lumio. Current milestone: **authentication only** —
log in against the Lumio backend and persist the session.

## Setup

1. Start the backend: from the repo root, `pnpm db:up` then `pnpm dev`
   (web app on http://localhost:3000). Create the admin account once at
   http://localhost:3000/setup if you haven't.
2. `cp apps/mobile/.env.example apps/mobile/.env` and set `EXPO_PUBLIC_API_URL`
   to a URL the device/simulator can reach (see comments in the file).
3. From `apps/mobile`: `npx expo start --clear`, then press `i` (iOS Simulator)
   or scan the QR with Expo Go.

## Notes

- Auth uses Better Auth's Expo plugin; the session token is stored in
  `expo-secure-store` and sent as a bearer token (no cookies).
- Two-factor accounts are detected but not yet supported in the app.
- Photo browsing, catalogs, and offline support are future milestones.
```

- [ ] **Step 3: Commit**

```bash
git add apps/mobile/.env.example apps/mobile/README.md
git commit -m "docs(mobile): env example + setup README"
```

---

## Task 10: End-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Prepare the backend**

```bash
pnpm db:up
pnpm dev
```

Ensure the admin account exists (visit `http://localhost:3000/setup` once if needed). Leave the dev server running.

- [ ] **Step 2: Configure and start the mobile app**

```bash
cp apps/mobile/.env.example apps/mobile/.env
cd apps/mobile && npx expo start --clear
```

Open the iOS Simulator (`i`). `localhost:3000` is reachable from the simulator.

- [ ] **Step 3: Verify the login flow**

- App opens on the **login** screen (no session yet → redirected from `/` to `/login`).
- Enter the admin email + password, tap **Sign in**.
- Expected: navigates to the **home** screen showing "You're signed in" and the admin email.

- [ ] **Step 4: Verify session persistence**

- Reload the app (press `r` in the Expo CLI, or shake → Reload).
- Expected: app opens directly on the **home** screen (token restored from secure store, no re-login).

- [ ] **Step 5: Verify sign-out**

- Tap **Sign out**.
- Expected: returns to the **login** screen; reloading the app keeps you on login (token cleared).

- [ ] **Step 6: Verify a wrong password is handled**

- Enter a wrong password.
- Expected: a readable error message appears; no crash.

- [ ] **Step 7: Final regression check**

```bash
pnpm --filter @lumio/web test
pnpm --filter @lumio/mobile test
```

Expected: both PASS.

---

## Self-review notes

- **Spec coverage:** scaffold (T1), monorepo wiring (T2), minimal deps (T3), server `expo()` + `trustedOrigins` (T4), `EXPO_PUBLIC_API_URL` config (T5/T9), Expo client with secure-store (T6), login with 2FA-not-crash handling (T7), protected home + redirects (T8), verification incl. web regression (T10). All spec sections map to a task.
- **Deviation from spec (intentional, YAGNI):** the spec sketched an `app/(app)/index.tsx` route group; the plan uses a flat `app/index.tsx` + `app/login.tsx` with per-screen `<Redirect>` guards — fewer files for a two-screen skeleton, same behavior. The `(app)` group can be introduced when more authenticated screens land.
- **2FA:** backend has `twoFactor()` enabled; a fresh admin account won't trigger it, but the login screen detects `twoFactorRedirect` and shows a message rather than crashing (spec requirement met).
- **pnpm/Metro risk:** primary path is the monorepo Metro config on the default linker, run via Expo Go (no native autolinking). `node-linker=hoisted` is documented as the fallback in Task 2.
