# Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone `/profile` page where the single owner account can edit their display name and change their password.

**Architecture:** A server component (`page.tsx`) does the auth guard and supplies the current name/email; two focused client components call Better Auth's client methods (`authClient.updateUser`, `authClient.changePassword`) — mirroring the existing `login-form.tsx` / `setup-form.tsx` pattern. A small pure helper holds the password validation so it can be unit-tested. A link is added to the sidebar "More" dropdown.

**Tech Stack:** Next.js 16 App Router, React client components, Better Auth (`better-auth/react` client), Tailwind + existing shadcn (`Button`, `Input`, `Label`, `Switch`, `InfoList`/`InfoRow`), Vitest, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-19-profile-page-design.md`

---

## File Structure

New files (all under `apps/web/src/app/(app)/profile/`):

- `validate-password-change.ts` — pure helper: validates new-password length + confirm match. One responsibility, unit-tested.
- `validate-password-change.test.ts` — Vitest unit tests for the helper.
- `page.tsx` — server component: auth guard + layout, renders the two forms.
- `account-form.tsx` — client component: read-only email + editable name (`authClient.updateUser`).
- `password-form.tsx` — client component: change password + "sign out other devices" toggle (`authClient.changePassword`).

Modified:

- `apps/web/src/components/sidebar-more.tsx` — add a "Profile" link above "Settings".

Convention note: in this repo, `.ts` test files import source with a `.js` extension (e.g. `./auth-paths.js`), while app `.tsx` files import extensionless (e.g. `./danger-zone`). Follow both conventions exactly as shown below.

---

## Task 1: Password-change validation helper (TDD)

**Files:**
- Create: `apps/web/src/app/(app)/profile/validate-password-change.ts`
- Test: `apps/web/src/app/(app)/profile/validate-password-change.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/(app)/profile/validate-password-change.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validatePasswordChange } from "./validate-password-change.js";

describe("validatePasswordChange", () => {
  it("rejects a new password shorter than 8 characters", () => {
    expect(validatePasswordChange("short", "short")).toBe(
      "New password must be at least 8 characters.",
    );
  });

  it("rejects when the confirmation does not match", () => {
    expect(validatePasswordChange("longenough1", "different1")).toBe(
      "Passwords do not match.",
    );
  });

  it("returns null when the password is long enough and matches", () => {
    expect(validatePasswordChange("longenough1", "longenough1")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`):

```bash
pnpm exec vitest run "src/app/(app)/profile/validate-password-change.test.ts"
```

Expected: FAIL — cannot resolve `./validate-password-change.js` (module/file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/app/(app)/profile/validate-password-change.ts`:

```ts
/** Client-side guard for the password-change form. Returns an error message, or null when valid. */
export function validatePasswordChange(
  newPassword: string,
  confirm: string,
): string | null {
  if (newPassword.length < 8) {
    return "New password must be at least 8 characters.";
  }
  if (newPassword !== confirm) {
    return "Passwords do not match.";
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `apps/web`):

```bash
pnpm exec vitest run "src/app/(app)/profile/validate-password-change.test.ts"
```

Expected: PASS — 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/profile/validate-password-change.ts" "apps/web/src/app/(app)/profile/validate-password-change.test.ts"
git commit -m "feat(web): add password-change validation helper"
```

---

## Task 2: Account form (editable name + read-only email)

**Files:**
- Create: `apps/web/src/app/(app)/profile/account-form.tsx`

This is a React client component; there is no component-test harness in this repo, so it is verified at build/lint time here and manually in Task 6.

- [ ] **Step 1: Write the component**

Create `apps/web/src/app/(app)/profile/account-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InfoList, InfoRow } from "@/components/ui/info-list";
import { authClient } from "@/lib/auth-client";

export function AccountForm({
  name: initialName,
  email,
}: {
  name: string;
  email: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);

  const trimmed = name.trim();
  const changed = trimmed.length > 0 && trimmed !== initialName;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    setPending(true);
    try {
      const { error } = await authClient.updateUser({ name: trimmed });
      if (error) {
        setError(error.message ?? "Could not update your name.");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-medium">Account</h2>
        <p className="text-sm text-muted-foreground">
          Your sign-in email and display name.
        </p>
      </div>

      <InfoList>
        <InfoRow label="Email" value={email} mono />
      </InfoList>

      <form onSubmit={onSubmit} className="grid max-w-sm gap-3">
        <div className="grid gap-2">
          <Label htmlFor="name">Name</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {saved && <p className="text-sm text-muted-foreground">Saved.</p>}
        <Button type="submit" disabled={!changed || pending} className="w-fit">
          {pending ? "Saving…" : "Save"}
        </Button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Verify it type-checks / lints**

Run (from `apps/web`):

```bash
pnpm lint
```

Expected: no errors for `account-form.tsx`. (It is not yet imported anywhere; that happens in Task 4.)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/profile/account-form.tsx"
git commit -m "feat(web): add profile account form (editable name)"
```

---

## Task 3: Password form (change password + revoke-others toggle)

**Files:**
- Create: `apps/web/src/app/(app)/profile/password-form.tsx`

Depends on Task 1 (imports `validatePasswordChange`). Uses the existing `Switch` component (controlled via `checked` / `onCheckedChange`).

- [ ] **Step 1: Write the component**

Create `apps/web/src/app/(app)/profile/password-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { authClient } from "@/lib/auth-client";
import { validatePasswordChange } from "./validate-password-change";

export function PasswordForm() {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState(false);
  const [revokeOther, setRevokeOther] = useState(true);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const currentPassword = String(form.get("currentPassword"));
    const newPassword = String(form.get("newPassword"));
    const confirm = String(form.get("confirm"));

    const validationError = validatePasswordChange(newPassword, confirm);
    if (validationError) {
      setError(validationError);
      return;
    }

    setPending(true);
    try {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: revokeOther,
      });
      if (error) {
        setError(error.message ?? "Could not change your password.");
        return;
      }
      setSaved(true);
      formEl.reset();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-medium">Password</h2>
        <p className="text-sm text-muted-foreground">
          Change the password you use to sign in.
        </p>
      </div>

      <form onSubmit={onSubmit} className="grid max-w-sm gap-3">
        <div className="grid gap-2">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>
        <div className="flex items-center justify-between gap-3 py-1">
          <Label htmlFor="revokeOther" className="font-normal">
            Sign out other devices
          </Label>
          <Switch
            id="revokeOther"
            checked={revokeOther}
            onCheckedChange={setRevokeOther}
          />
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        {saved && (
          <p className="text-sm text-muted-foreground">Password updated.</p>
        )}
        <Button type="submit" disabled={pending} className="w-fit">
          {pending ? "Updating…" : "Update password"}
        </Button>
      </form>
    </section>
  );
}
```

- [ ] **Step 2: Verify it type-checks / lints**

Run (from `apps/web`):

```bash
pnpm lint
```

Expected: no errors for `password-form.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/profile/password-form.tsx"
git commit -m "feat(web): add profile password-change form"
```

---

## Task 4: Profile page (server component + auth guard)

**Files:**
- Create: `apps/web/src/app/(app)/profile/page.tsx`

Depends on Tasks 2 and 3 (renders both forms). Mirrors the settings page shell and the `getServerSession` guard pattern.

- [ ] **Step 1: Write the page**

Create `apps/web/src/app/(app)/profile/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { getServerSession } from "@/lib/server-session";
import { AccountForm } from "./account-form";
import { PasswordForm } from "./password-form";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const session = await getServerSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Profile</h1>
      <AccountForm name={session.user.name} email={session.user.email} />
      <PasswordForm />
    </main>
  );
}
```

- [ ] **Step 2: Verify it type-checks / lints**

Run (from `apps/web`):

```bash
pnpm lint
```

Expected: no errors. (If `session.user.name`/`email` produce a type error, confirm the Better Auth session type via `getServerSession`'s return — `session.user` carries `name` and `email`.)

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/profile/page.tsx"
git commit -m "feat(web): add /profile page"
```

---

## Task 5: Add Profile link to the sidebar "More" dropdown

**Files:**
- Modify: `apps/web/src/components/sidebar-more.tsx`

- [ ] **Step 1: Add the `User` icon import**

In `apps/web/src/components/sidebar-more.tsx`, change the lucide import line:

```tsx
import { LogOut, Monitor, MoreHorizontal, Moon, Settings, Sun, Trash2 } from "lucide-react";
```

to:

```tsx
import { LogOut, Monitor, MoreHorizontal, Moon, Settings, Sun, Trash2, User } from "lucide-react";
```

- [ ] **Step 2: Add the Profile menu item above Settings**

Find this block:

```tsx
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden />
            Settings
          </Link>
        </DropdownMenuItem>
```

and insert a Profile item immediately before it, so it reads:

```tsx
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <User aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings aria-hidden />
            Settings
          </Link>
        </DropdownMenuItem>
```

- [ ] **Step 3: Verify it lints and the full test suite passes**

Run (from `apps/web`):

```bash
pnpm lint && pnpm test
```

Expected: lint clean; Vitest reports all tests passing (including the 3 from Task 1).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/sidebar-more.tsx
git commit -m "feat(web): link Profile from sidebar More menu"
```

---

## Task 6: Manual browser verification

No code changes — confirm the feature works end-to-end. The dev server runs from the repo root with `pnpm --filter @lumio/web dev` (Next on the workspace URL/port).

- [ ] **Step 1: Open the app and navigate**

Log in, click the sidebar **More** button, click **Profile**. Confirm `/profile` loads showing the read-only email, the name field seeded with the current name, and the Password section with the "Sign out other devices" switch defaulting to **on**.

- [ ] **Step 2: Edit the name**

Change the name; confirm **Save** enables only after the value changes. Click Save → "Saved." appears and the name persists on reload.

- [ ] **Step 3: Password validation paths**

- Enter a new password under 8 chars → "New password must be at least 8 characters."
- Enter mismatched new/confirm → "Passwords do not match."
- Enter a wrong current password with a valid new/confirm → Better Auth's error message appears inline.

- [ ] **Step 4: Successful password change**

Enter the correct current password and a valid matching new password, leave the switch on, submit → "Password updated.", fields clear, and the current session stays logged in. Optionally sign in from another browser first to confirm that session is revoked.

- [ ] **Step 5: Guard check**

Log out, then visit `/profile` directly → redirected to `/login`.

---

## Self-Review Notes

- **Spec coverage:** standalone `/profile` route (Task 4) ✓; edit name (Task 2) ✓; change password with revoke-others toggle (Task 3) ✓; email read-only (Task 2) ✓; sidebar link (Task 5) ✓; validation helper + test (Task 1) ✓; manual verification in lieu of a component-test harness (Task 6) ✓.
- **Type consistency:** helper is `validatePasswordChange(newPassword, confirm)` in Task 1 and called identically in Task 3; `AccountForm` props `{ name, email }` match the page's usage in Task 4; `PasswordForm` takes no props.
- **No placeholders:** every code step shows complete file content; every command has an expected result.
