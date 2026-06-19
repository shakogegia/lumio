"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackupCodes } from "./backup-codes";

export function TwoFactorManage() {
  const router = useRouter();
  const [disablePassword, setDisablePassword] = useState("");
  const [regenPassword, setRegenPassword] = useState("");
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"disable" | "regen" | null>(null);

  async function disable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending("disable");
    try {
      const { error } = await authClient.twoFactor.disable({
        password: disablePassword,
      });
      if (error) {
        setError(error.message ?? "Could not disable two-factor.");
        return;
      }
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(null);
    }
  }

  async function regenerate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending("regen");
    try {
      const { data, error } = await authClient.twoFactor.generateBackupCodes({
        password: regenPassword,
      });
      if (error || !data) {
        setError(error?.message ?? "Could not regenerate backup codes.");
        return;
      }
      setNewCodes(data.backupCodes);
      setRegenPassword("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Two-factor authentication is <strong>on</strong>. You’ll enter a code
        from your authenticator app when you sign in.
      </p>

      {newCodes ? (
        <BackupCodes codes={newCodes} />
      ) : (
        <form onSubmit={regenerate} className="grid max-w-sm gap-3">
          <Label htmlFor="tf-regen-password">
            Regenerate backup codes (replaces old ones)
          </Label>
          <Input
            id="tf-regen-password"
            type="password"
            autoComplete="current-password"
            placeholder="Current password"
            value={regenPassword}
            onChange={(e) => setRegenPassword(e.target.value)}
            required
          />
          <Button
            type="submit"
            variant="outline"
            disabled={pending !== null || regenPassword.length === 0}
            className="w-fit"
          >
            {pending === "regen" ? "Generating…" : "Regenerate backup codes"}
          </Button>
        </form>
      )}

      <form onSubmit={disable} className="grid max-w-sm gap-3 border-t border-foreground/10 pt-4">
        <Label htmlFor="tf-disable-password">Disable two-factor</Label>
        <Input
          id="tf-disable-password"
          type="password"
          autoComplete="current-password"
          placeholder="Current password"
          value={disablePassword}
          onChange={(e) => setDisablePassword(e.target.value)}
          required
        />
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="destructive"
          disabled={pending !== null || disablePassword.length === 0}
          className="w-fit"
        >
          {pending === "disable" ? "Disabling…" : "Disable two-factor"}
        </Button>
      </form>
    </div>
  );
}
