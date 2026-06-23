# Lumio Mobile — Auth Walking Skeleton

**Date:** 2026-06-23
**Status:** Implemented (skeleton); amended for runtime server URL (see AMENDMENT 2)
**Scope:** First milestone of the Lumio mobile app — authentication only.

> **AMENDMENT 2 (2026-06-23): runtime server URL (self-hosted model).**
> Lumio is self-hosted: the server/web is run by each user, but the mobile app is
> a single shared/published binary. So the backend URL **cannot** be a build-time
> constant (`EXPO_PUBLIC_API_URL`) — each user must enter *their* server URL at
> runtime, the same pattern as Immich / Jellyfin / Nextcloud. This amendment
> supersedes the build-time URL as the product mechanism.
>
> **Changes:**
> - **New first screen `connect`**: user types their server URL; we validate it's
>   reachable and a Lumio/Better-Auth server via `GET <url>/api/auth/ok` (fallback
>   `GET <url>/api/auth/get-session`) before saving; the validated base URL is
>   persisted in `expo-secure-store` (key `lumio.serverUrl`).
> - **Auth client is no longer a module singleton** (Better Auth's `baseURL` is
>   fixed at creation). It becomes a factory `createLumioAuthClient(baseURL)` used
>   by an **`AuthProvider`** that loads the stored URL, builds a memoized client,
>   and exposes `serverUrl / isLoading / session / isPending / signIn / signOut /
>   connect / disconnect` via `useAuth()`. The provider owns the single
>   `client.useSession()` call so screens never call hooks on a possibly-absent
>   client. While `serverUrl` is unset, the client uses a harmless placeholder URL.
> - **Flow:** launch → load stored URL → no URL → `connect` → `login` → home.
>   `login` and home both offer **"Change server"** (= `disconnect`: best-effort
>   `signOut` + clear stored URL → back to `connect`).
> - **`resolveApiBaseUrl` is repurposed/renamed `normalizeServerUrl`**: a pure
>   validator/normalizer for the *user-typed* URL (trim, require http(s), strip
>   trailing slash). Its vitest tests carry over.
> - **No build-time backend URL at all.** There is no `EXPO_PUBLIC_API_URL` and
>   no `.env` for the mobile app — the user types the server URL on the `connect`
>   screen every fresh install (iOS Simulator: `http://localhost:3000`). (An
>   earlier revision pre-filled the field from `EXPO_PUBLIC_API_URL` written by
>   Conductor's `run.sh`; that was removed as unnecessary once runtime entry
>   landed.)
> - **`make ios`** added to launch the app in the iOS Simulator.
> - Out of scope (future): per-server token isolation (switching servers requires
>   re-login — a single `storagePrefix` is fine for the skeleton); server history /
>   multiple saved servers; QR/auto-discovery.

## Goal

Stand up an Expo app inside the Lumio monorepo (`apps/mobile`) and prove the
single riskiest vertical slice on mobile: **logging in against the existing
Better Auth backend and persisting the session.** No photo browsing yet — a
blank/placeholder authenticated home screen is the finish line for this
milestone.

Lumio is API-first and the roadmap notes Better Auth was chosen *specifically*
to enable an Expo client, so this milestone validates that assumption.

## Non-goals (deferred to later milestones)

- Photo grid / infinite scroll / image rendering
- Catalog selection UI
- Full 2FA TOTP entry screen (backend has `twoFactor` enabled; we must not
  crash on a 2FA challenge, but the dedicated TOTP UI is deferred)
- Social login (Apple/Google)
- Offline / caching / data-layer libraries (TanStack Query etc.)

## Architecture

### Placement
Expo app lives at `apps/mobile`, inside the existing pnpm workspace (already
globbed by `apps/*` in `pnpm-workspace.yaml`). This lets it import
`@lumio/shared` (framework-agnostic types/enums/Zod, no Prisma/Next) and stay in
sync with the API contract.

### Stack
- **Expo** (latest stable SDK), **TypeScript**.
- **Expo Router** — file-based routing, the Expo standard.
- **App scheme:** `lumio` (deep links + Better Auth redirects).
- **Dependencies (minimal):** `expo`, `expo-router`, `expo-secure-store`,
  `better-auth`, `@better-auth/expo`, plus Expo defaults (`react`,
  `react-native`, etc.). Nothing beyond what auth needs.

### Monorepo wiring (pnpm + Metro)
This is the known sharp edge and is part of the scaffolding work:
- `apps/mobile/metro.config.js` with `watchFolders = [repoRoot]` and
  `nodeModulesPaths` covering both app-local and root `node_modules`, so Metro
  resolves hoisted deps and the `@lumio/shared` workspace package.
- A pnpm hoisting accommodation for React Native's flat-module expectations —
  either an `apps/mobile/.npmrc` or a root `public-hoist-pattern`. Chosen during
  implementation based on what installs cleanly.
- Verify `pnpm install` from the repo root resolves the new app without breaking
  existing workspaces.

### Auth integration

**Mobile (`apps/mobile/lib/auth-client.ts`):**
`createAuthClient` with `expoClient({ scheme: "lumio", storage: SecureStore })`.
The session token is stored in `expo-secure-store` and attached as a bearer
token automatically (no browser cookies on mobile).

**Server (small additive edit to `apps/web/src/lib/auth.ts`):**
- Add the `expo()` plugin from `@better-auth/expo`.
- Add `lumio://` to `trustedOrigins`.
These are additive; existing web cookie-based auth is unaffected.

**Backend URL:**
Read from `EXPO_PUBLIC_API_URL` (Expo public env var), documented in the app's
env example. A physical device needs a LAN IP or tunnel — `localhost` only works
in the simulator/web. Default to a sensible dev value and document the caveat.

### Screens
- `app/_layout.tsx` — root layout; wraps app, drives session-based redirects.
- `app/login.tsx` — email + password form → `authClient.signIn.email`. Handles
  the error case and the 2FA-redirect case gracefully (no crash; full TOTP UI
  deferred).
- `app/(app)/index.tsx` — protected placeholder home: shows the signed-in user
  and a sign-out action. No session → redirect to `/login`; authenticated on
  `/login` → redirect here.

## Error handling
- Login failures (bad credentials, network/unreachable backend) surface a
  readable message rather than crashing.
- A 2FA challenge response is detected and handled without crashing (deferred UI
  shows a "2FA required" message at minimum).
- Missing/blank `EXPO_PUBLIC_API_URL` fails fast with a clear message.

## Testing / verification
- `pnpm install` from repo root completes cleanly; existing workspaces still
  build.
- App boots in Expo (web target and/or iOS simulator).
- Against a running web backend: sign-in succeeds, session persists across app
  reload (token in secure store), sign-out clears it and returns to `/login`.
- Server-side `expo()` plugin change does not regress existing web auth (web app
  still logs in).
