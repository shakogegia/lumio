# Design: Two-Factor Auth (TOTP) + Active Sessions

**Date:** 2026-06-19
**Status:** Approved (brainstorm) — pending implementation plan
**Area:** `apps/web` (Next.js App Router) + `packages/db` (Prisma)

## Overview

Add **TOTP-based two-factor authentication with backup codes** and an **active
sessions list** to Lumio, both managed from a new **Security** tab on the
profile page. Built entirely on Better Auth's `twoFactor` plugin and its
built-in session APIs — no email provider is required.

Decisions locked during brainstorming:

1. **2FA method:** TOTP (authenticator app) + backup codes only. No email OTP
   (the app has no email provider, and email-as-second-factor is weaker). TOTP
   works offline and needs no new infrastructure.
2. **Profile layout:** one **Security** tab. The existing Password card moves
   under it, joined by a Two-Factor card and an Active Sessions card. (Avoids a
   row of four top-level tabs.)
3. **Login flow:** a dedicated `/two-factor` verification page (keeps the login
   form single-purpose; matches how Better Auth's 2FA redirect is meant to be
   handled).

## Current state (verified)

- **Better Auth server:** `apps/web/src/lib/auth.ts` — `betterAuth()` with the
  Prisma adapter (PostgreSQL), email+password only, no plugins, a signup-gate
  middleware that blocks signup after the first user is created.
- **Better Auth client:** `apps/web/src/lib/auth-client.ts` — `createAuthClient()`
  with no plugins; exports `signIn`, `signUp`, `signOut`, `useSession`,
  `authClient`.
- **API handler:** `apps/web/src/app/api/auth/[...all]/route.ts`
  (`toNextJsHandler(auth)`, nodejs runtime).
- **DB:** Prisma 6 / PostgreSQL. Models `User`, `Session`, `Account`,
  `Verification` already exist (PascalCase, no `@@map`, camelCase fields,
  `cuid()` ids, cascade-delete relations to `User`). Migrations run via
  `pnpm db:migrate`; client regen via `pnpm db:generate`.
- **Routing:** No `middleware.ts`. The `(app)` route group is guarded in
  `(app)/layout.tsx` via `getServerSession()` → `redirect("/login")`. The
  `(auth)` route group (`login`, `setup`) is a public two-column brand shell
  with no session guard.
- **Login form:** `(auth)/login/login-form.tsx` (client) calls
  `signIn.email({ email, password })` then `router.replace("/photos")`.
- **Profile:** `(app)/profile/page.tsx` is a server component (redirects to
  `/login` if no session) rendering a shadcn `Tabs` with **Account**
  (`account-form.tsx` → `authClient.updateUser`) and **Password**
  (`password-form.tsx` → `authClient.changePassword({ revokeOtherSessions })`).
- **UI:** shadcn/ui (Card, Tabs, Dialog, Input, Label, Button, Switch, Badge,
  Separator, sonner toasts), Tailwind 4, lucide-react icons.

## Better Auth config changes

### `apps/web/src/lib/auth.ts`
- Add `appName: "Lumio"` — used as the TOTP issuer label shown in authenticator
  apps.
- Add `twoFactor()` (from `better-auth/plugins`) to `plugins`.

### `apps/web/src/lib/auth-client.ts`
- Add `twoFactorClient()` (from `better-auth/client/plugins`) to `plugins`.
- **Do not** rely on the global `onTwoFactorRedirect` callback (it does a full
  page reload). Instead, handle the redirect inside the login form using Next's
  client router (below), so navigation stays client-side.

## Database (Prisma)

Applied via the project's normal Prisma flow (`pnpm db:migrate`), **not** the
Better Auth CLI's own migrator. One new migration.

- **`User`**: add `twoFactorEnabled Boolean @default(false)` and the back-relation
  `twoFactors TwoFactor[]`.
- **New `TwoFactor` model** (matching existing model conventions):

  ```prisma
  model TwoFactor {
    id          String  @id @default(cuid())
    secret      String
    backupCodes String
    userId      String
    user        User    @relation(fields: [userId], references: [id], onDelete: Cascade)

    @@index([userId])
  }
  ```

> **Implementation note:** before writing the migration, run the Better Auth CLI
> generator (`pnpm dlx @better-auth/cli generate`) against the pinned
> `better-auth@1.6.19` to confirm the exact field set the plugin expects for this
> version (e.g. whether a `verified` column is required), then translate that into
> the Prisma model + migration. The plugin will error at runtime if a column it
> reads/writes is missing, so the schema must match the installed version exactly.

No change to the `Session` table — it already stores `ipAddress`, `userAgent`,
`createdAt`, `expiresAt`, `token`, which is everything the sessions list needs.

## Login flow: the `/two-factor` page

When a 2FA-enabled user signs in with email+password, Better Auth does **not**
create a session; it returns `data.twoFactorRedirect === true` and issues a
temporary 2FA-challenge cookie. The user must verify a second factor first.

- **`(auth)/login/login-form.tsx`**: after `signIn.email(...)`, branch on the
  result — if `data?.twoFactorRedirect`, `router.replace("/two-factor")`;
  otherwise `router.replace("/photos")` as today.
- **New `(auth)/two-factor/page.tsx`** + **`two-factor-verify-form.tsx`** (client),
  living in the existing `(auth)` shell so the page is reachable mid-login (before
  a full session exists):
  - Default: 6-digit code input → `authClient.twoFactor.verifyTotp({ code, trustDevice })`.
    On success → `router.replace("/photos")`.
  - "Use a backup code instead" toggle → `authClient.twoFactor.verifyBackupCode({ code })`.
  - "Trust this device for 30 days" checkbox (passes `trustDevice: true`; skips
    2FA on this device for 30 days, refreshed on each sign-in).
  - If a full session already exists when the page loads, redirect to `/photos`.
  - Invalid/expired codes show an inline error and allow retry; a "Back to login"
    link returns to `/login`.

## Profile → Security tab

`(app)/profile/page.tsx` gains a second tab. The existing **Password** card moves
under **Security** unchanged. Two new cards join it.

### a) Two-Factor card — `two-factor-section.tsx` (client)
State is driven by `session.user.twoFactorEnabled`.

- **Disabled state:** "Enable two-factor authentication" button → password-confirm
  dialog → `authClient.twoFactor.enable({ password })` returns `{ totpURI, backupCodes }`
  (this does **not** yet flip `twoFactorEnabled`). The enrollment view then shows:
  - a **QR code** rendered from `totpURI` (new dep `react-qr-code`) plus the
    manual-entry secret as a fallback,
  - the **backup codes** with copy and download actions,
  - a 6-digit code field → `authClient.twoFactor.verifyTotp({ code })` which flips
    2FA on. Then `router.refresh()` to re-read the session.
- **Enabled state:** "Two-factor is on" status, **Regenerate backup codes**
  (password-confirmed → `authClient.twoFactor.generateBackupCodes({ password })`,
  shows the new set once), and **Disable** (password-confirmed →
  `authClient.twoFactor.disable({ password })` → `router.refresh()`).

Backup codes are surfaced only at enrollment and regeneration time (their
endpoints return the codes directly), which avoids relying on `viewBackupCodes`
and its fresh-session requirement.

### b) Active Sessions card — `sessions-list.tsx` (client)
`(app)/profile/page.tsx` (server) fetches the data and passes it down:
- `auth.api.listSessions({ headers: await headers() })` for the rows,
- the current session token (from the already-fetched session) to mark "this
  device".

Each row shows:
- **device** — browser + OS parsed from `userAgent`,
- **IP address**,
- **signed-in / last-active** time,
- a **"This device"** badge on the current session.

Actions:
- Per-row **Sign out** → `authClient.revokeSession({ token })` then `router.refresh()`.
  The current session's row has no Sign-out button (that would just be logging
  out).
- **"Sign out all other devices"** → `authClient.revokeOtherSessions()` then
  `router.refresh()`.

A small pure util **`parse-user-agent.ts`** maps a `userAgent` string to
`{ browser, os }` with a graceful "Unknown device" fallback — avoids adding a
UA-parsing dependency.

## Component boundaries (new / changed)

```
lib/auth.ts                                     (+ appName, twoFactor())
lib/auth-client.ts                              (+ twoFactorClient())
packages/db/prisma/schema.prisma                (+ twoFactorEnabled, TwoFactor) + migration
(auth)/login/login-form.tsx                     (handle twoFactorRedirect branch)
(auth)/two-factor/page.tsx                      (new)
(auth)/two-factor/two-factor-verify-form.tsx    (new, client)
(app)/profile/page.tsx                          (add Security tab; fetch sessions)
(app)/profile/two-factor-section.tsx            (new, client)
(app)/profile/sessions-list.tsx                 (new, client)
(app)/profile/parse-user-agent.ts               (new, pure util)
(app)/profile/password-form.tsx                 (moves under Security tab, unchanged)
```

New runtime dependency: `react-qr-code` (in `apps/web`). Everything else uses
Better Auth built-ins.

## Error handling & edge cases

- Wrong password on enable / disable / regenerate → inline error, no state change.
- Wrong or expired TOTP / backup code → inline error, allow retry.
- Abandoned enrollment (enabled but never verified) → `twoFactorEnabled` stays
  `false`; re-enabling regenerates the secret. Backup codes are shown only at
  enrollment/regeneration.
- Revoking the current session is not offered in the list (it would just be a
  sign-out); "Sign out all other devices" excludes the current session by design.
- **Signup-gate middleware:** the 2FA plugin discards the pending session during a
  challenge and resets `ctx.context.newSession` to `null`. The existing middleware
  only gates the signup endpoint and does not read `newSession` on sign-in, so
  risk is low — but implementation must confirm the middleware still behaves with
  the plugin enabled and null-checks `newSession` if it ever reads it.

## Testing

- **Unit:** `parse-user-agent.ts` (representative UA strings → browser/OS, plus the
  unknown fallback), following the existing test setup in the repo.
- **Integration:** enable → verify happy path by computing a valid TOTP code from
  the secret returned by `enable` (using a TOTP library in the test);
  `revokeSession` removes the row from `listSessions`.
- **Manual browser verification (final):** enroll 2FA → sign out → sign in →
  `/two-factor` challenge → land in app; open Security tab → see the session list →
  revoke another session / "sign out all other devices"; disable 2FA.

## Out of scope

- Email/SMS OTP as a second factor (no email provider; explicitly deferred).
- Passkeys / WebAuthn.
- Geolocation lookup for session IPs (raw IP only).
- Multi-user admin management of other users' 2FA/sessions (app is effectively
  single-user via the signup gate).
