# Passkey Authentication (Web) — Design

**Date:** 2026-06-24
**Status:** Approved (user pre-approved plan + execution)
**Scope:** Web app only (`apps/web`). Mobile (`apps/mobile`) deferred.

## Summary

Add WebAuthn/FIDO2 passkey authentication to the Lumio web app using Better Auth's
first-party `@better-auth/passkey` plugin (built on SimpleWebAuthn). The single
existing user can register passkeys (Face ID / Touch ID / security keys) from
**Account → Security**, and **sign in with a passkey in one step** on the login page.
Email/password + TOTP 2FA remain unchanged as the fallback.

## Goals

- Register / list / rename / delete passkeys from Account → Security (session required).
- "Sign in with a passkey" button on the login page; passkey sign-in completes in a
  single step (no TOTP prompt afterward).
- Zero regressions to the existing email/password + 2FA flows.

## Non-goals

- Native passkeys in the Expo mobile app — separate follow-up (needs native WebAuthn
  modules + associated-domains config).
- Passkey-first / passwordless onboarding. The signup gate stays; passkeys are added
  *after* the user authenticates.

## Decisions

- **2FA interaction:** a passkey sign-in is a complete, phishing-resistant factor, so it
  **skips TOTP**. This falls out naturally: `authClient.signIn.passkey()` returns a
  session directly; the `twoFactorRedirect` only fires on email/password sign-in. Password
  login still requires TOTP exactly as today.
- **`registration.requireSession: true`** (Better Auth default) — passkeys are added by
  the already-authenticated user, so the signup gate (`assertSignupAllowed`) is unaffected.
- **`rpID` / `origin`:** auto-derived from `BETTER_AUTH_URL` (→ `localhost` /
  `http://localhost:3000` in dev; the real domain in prod). Nothing hardcoded.

## Architecture / Components

### Dependencies
- Add `@better-auth/passkey@1.6.19` to `apps/web` (matches the pinned `better-auth` /
  `@better-auth/expo` 1.6.19; peer dep `better-auth: ^1.6.19` satisfied). It is NOT
  bundled in core `better-auth` 1.6.x, so this is a genuine new dependency.

### Server — `apps/web/src/lib/server/auth.ts`
- `import { passkey } from "@better-auth/passkey"`; add `passkey()` to the `plugins`
  array alongside `twoFactor()` and `expo()`. Default config (auto rpID/origin,
  `requireSession: true`).
- The existing `assertSignupAllowed` before-hook is unaffected (passkey registration
  requires a session, not account creation).

### Client — `apps/web/src/lib/auth-client.ts`
- `import { passkeyClient } from "@better-auth/passkey/client"`; add to `plugins`.
  Exposes `authClient.passkey.*` and `authClient.signIn.passkey`.

### Database — `packages/db/prisma/schema.prisma`
- Add a `Passkey` model (PascalCase, matching `User`/`TwoFactor` convention) with Better
  Auth's required fields:
  `id` (PK, `@default(cuid())`), `name?`, `publicKey`, `userId` (FK → `User`,
  `onDelete: Cascade`), `credentialID`, `counter Int`, `deviceType`, `backedUp Boolean`,
  `transports?`, `createdAt? @default(now())`, `aaguid?`. `@@index([userId])`.
- Add `passkeys Passkey[]` relation to `User`.
- **Migration (shared-DB safe — NEVER `migrate dev`/`reset`):** hand-write
  `packages/db/prisma/migrations/<YYYYMMDDHHMMSS>_add_passkey/migration.sql`
  (`CREATE TABLE "Passkey"` + index + FK), apply with
  `pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma migrate deploy`, then
  `prisma generate`. Verify with `prisma migrate status`. The table add is purely additive.

### UI — Account → Security
- New `apps/web/src/app/(app)/settings/account/passkey-section.tsx` (`"use client"`):
  lists the user's passkeys (`authClient.passkey.listUserPasskeys`), with a friendly label
  via `getAuthenticatorName(aaguid)` fallback; "Add passkey" (`addPasskey`); rename
  (`updatePasskey`) and delete (`deletePasskey`). Follows the existing section/card style.
- Wire a "Passkeys" `Card` into the **Security** tab of
  `apps/web/src/app/(app)/settings/account/page.tsx`, after the 2FA card.

### UI — Login — `apps/web/src/app/(auth)/login/login-form.tsx`
- Add a "Sign in with a passkey" button → `authClient.signIn.passkey()`, on success
  `router.replace("/")`; surface `error.message` inline.
- Optional conditional-UI autofill: `autocomplete="email webauthn"` on the email input
  plus a guarded `useEffect` preload (check `PublicKeyCredential.isConditionalMediation
  Available()` first). React-Compiler note: the effect only kicks off the autofill call —
  no synchronous `setState` in the effect body.

## Error handling

- `addPasskey` / `signIn.passkey` always return `{ data, error }` (never throw, per docs) —
  surface `error.message` inline, matching `login-form` / `two-factor-verify-form`.
- User cancels the WebAuthn prompt → returns an error; show a soft message, no state
  corruption.
- Server reads (`listPasskeys`) wrapped in try/catch where they could throw on stale
  session, mirroring the existing `listSessions` handling.

## Testing / gates

- **Lint:** `pnpm --filter @lumio/web exec eslint <changed files>` (React-Compiler rules).
- **Web typecheck:** `pnpm --filter @lumio/web exec tsc --noEmit -p tsconfig.json`
  (clean baseline; `@lumio/web` has no `typecheck` script). Ignore pre-existing
  `packages/shared/src/calendar.ts` errors elsewhere.
- **Tests:** `pnpm --filter @lumio/web test` — existing suite must stay green.
- **Build:** `next build --webpack`.
- **Browser verify:** with Chrome DevTools virtual authenticator — register a passkey,
  sign in with it in one step, confirm it skips TOTP, then list / rename / delete.

## Rollback

Additive and low-risk: remove the two plugin lines + the UI cards (+ optionally drop the
`Passkey` table). No migration of existing user data.
