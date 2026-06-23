# Lumio Mobile

Expo (SDK 56) client for Lumio. Current milestone: **authentication only** —
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
- Typed routes are enabled. On a fresh checkout, run `npx expo start` once so
  Expo generates `.expo/types` before relying on `npx tsc --noEmit`.
- Photo browsing, catalogs, and offline support are future milestones.
