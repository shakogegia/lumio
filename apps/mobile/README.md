# Lumio Mobile

Expo (SDK 56) client for Lumio. Current milestone: **authentication only** —
log in against the Lumio backend and persist the session.

## Setup

1. Start the backend: from the repo root, `pnpm db:up` then `pnpm dev`
   (web app on http://localhost:3000). Create the admin account once at
   http://localhost:3000/setup if you haven't.
2. (Optional, dev) `cp apps/mobile/.env.example apps/mobile/.env` to pre-fill the
   connect screen with a URL the device/simulator can reach (see the file).
3. From `apps/mobile`: `npx expo start --clear`, then press `i` (iOS Simulator)
   or scan the QR with Expo Go. (`make ios` from the repo root is a shortcut.)

## Notes

- On first launch the app asks for your Lumio **server URL** (the `connect`
  screen) and remembers it (in `expo-secure-store`). Use **Change server** to
  switch. `EXPO_PUBLIC_API_URL` (in `.env`) only pre-fills that field in dev.
- Auth uses Better Auth's Expo plugin; the session token is stored in
  `expo-secure-store` and sent as a bearer token (no cookies).
- Two-factor accounts are detected but not yet supported in the app.
- Typed routes are enabled. On a fresh checkout, run `npx expo start` once so
  Expo generates `.expo/types` before relying on `npx tsc --noEmit`.
- Photo browsing, catalogs, and offline support are future milestones.
