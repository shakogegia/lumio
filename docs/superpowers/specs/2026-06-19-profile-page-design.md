# Profile page — design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Goal

Give the single owner account a simple, standalone **Profile** page where they can
edit their display name and change their password. Lumio is a single-user app
(signup is permanently gated shut after the first account via
`assertSignupAllowed`), so "profile" means managing that one owner account.

## Scope

In scope:

- A standalone `/profile` page (its own route, not a tab in `/settings`).
- Edit the account **name**.
- **Change password** (current → new + confirm), with an option to sign out
  other sessions.
- A **Profile** entry in the sidebar "More" dropdown.

Out of scope (explicitly deferred):

- Editing the **email** (it is the login identifier; Better Auth treats this as
  a verified change-email flow). Email is shown **read-only** for context.
- Avatar / profile image.
- Password reset via email, 2FA, session management UI beyond the
  revoke-on-change toggle.

## Approach

Client-side via the existing Better Auth client (`authClient`), matching the
established pattern in `login-form.tsx` and `setup-form.tsx`:

- `authClient.updateUser({ name })` for the name.
- `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })`
  for the password.

The page itself is a server component that performs the auth guard and supplies
the initial name/email. No new API routes or server actions — Better Auth's
client methods already hit the authenticated endpoints, so adding route handlers
would be extra surface with no benefit.

## Architecture

### Route & guard

`apps/web/src/app/(app)/profile/page.tsx` — server component, `export const
dynamic = "force-dynamic"`.

- Calls `getServerSession()` (from `@/lib/server-session`).
- If the session is null, `redirect("/login")`.
- Passes `session.user.name` and `session.user.email` into the client forms.

### Layout

Same shell as the Settings page for visual consistency, with the two areas split
into **tabs** (mirroring the Settings page's `Tabs`): an **Account** tab and a
**Password** tab. The tab label serves as each section's heading (so the forms
don't repeat an `<h2>`), matching the Settings convention.

```
<main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
  <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
  <Tabs defaultValue="account">
    <TabsList>Account · Password</TabsList>
    <TabsContent value="account"><AccountForm/></TabsContent>
    <TabsContent value="password"><PasswordForm/></TabsContent>
  </Tabs>
</main>
```

### Components

Two focused client components plus the server page:

- **`account-form.tsx`** — Account section.
  - Email shown read-only via existing `InfoList` / `InfoRow`.
  - A "Name" `Input` seeded with the current name and a **Save** button.
  - Save is disabled until the name actually changes (and while pending).
  - On submit: `authClient.updateUser({ name })`, then `router.refresh()` so the
    new name propagates to the rest of the UI. Show a brief success message.
- **`password-form.tsx`** — Password section.
  - Three inputs: current password, new password, confirm new password
    (`autoComplete`: `current-password`, `new-password`, `new-password`).
  - A **"Sign out other devices"** toggle using the existing `Switch` component
    (`ui/switch.tsx`), defaulting to **on**. (No `Checkbox` exists in `ui/`;
    reusing `Switch` avoids adding a new `ui/*` component.)
  - **Update password** button.
  - On submit: client-side validation (below), then
    `authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions })`.
  - On success: clear all three fields and show a brief success message.

Reused UI primitives (all already present in `@/components/ui/*`): `Button`,
`Input`, `Label`, `Switch`, `InfoList` / `InfoRow`.

### Navigation

Add a **Profile** item to `SidebarMore` (`components/sidebar-more.tsx`), placed
above the existing **Settings** item, using the lucide `User` icon and linking to
`/profile`.

## Data flow

1. User opens `/profile` → server component reads session → renders forms seeded
   with name (editable) and email (read-only).
2. Name save → `authClient.updateUser` → `router.refresh()`.
3. Password change → `authClient.changePassword` → on success the current tab
   stays signed in; if "sign out other devices" was on, all other sessions are
   revoked server-side by Better Auth.

## Validation & error handling

Password client-side guard (before calling the API):

- New password length ≥ 8 (matches the setup form's `minLength={8}`).
- New password === confirm; otherwise show "Passwords do not match." (matches
  the setup form's wording).

Errors surface **inline** via `role="alert"` text, matching the existing forms —
no toasts:

- Wrong current password / API errors → show Better Auth's `error.message`,
  falling back to a generic message.
- Network / unexpected → "Something went wrong. Please try again." (matches
  login/setup forms).

## Testing

The codebase has unit tests for lib helpers (`with-auth.test.ts`,
`auth-paths.test.ts`) but **no component tests** for the existing auth forms, and
no component-testing harness. To match the codebase, the Profile page is verified
**manually in the browser** rather than introducing a new test harness.

The one pure, testable piece — password-change validation — is extracted into a
small helper `validatePasswordChange(newPassword, confirm)` returning an error
string or null, with a `validate-password-change.test.ts`. The form imports this
helper so the validation logic is covered without rendering React.

## Files

New:

- `apps/web/src/app/(app)/profile/page.tsx`
- `apps/web/src/app/(app)/profile/account-form.tsx`
- `apps/web/src/app/(app)/profile/password-form.tsx`
- `apps/web/src/app/(app)/profile/validate-password-change.ts`
- `apps/web/src/app/(app)/profile/validate-password-change.test.ts`

Changed:

- `apps/web/src/components/sidebar-more.tsx` (add Profile link)
