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
      <p className="text-sm text-muted-foreground">
        Change the password you use to sign in.
      </p>

      <form onSubmit={onSubmit} className="grid max-w-sm gap-3">
        <div className="grid gap-2">
          <Label htmlFor="currentPassword">Current password</Label>
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            onChange={() => setSaved(false)}
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
            onChange={() => setSaved(false)}
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
            onChange={() => setSaved(false)}
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
