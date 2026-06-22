"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function TwoFactorVerifyForm() {
  const router = useRouter();
  const [useBackup, setUseBackup] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { error } = useBackup
        ? await authClient.twoFactor.verifyBackupCode({ code })
        : await authClient.twoFactor.verifyTotp({ code, trustDevice });
      if (error) {
        setError(error.message ?? "That code didn’t work. Try again.");
        return;
      }
      router.replace("/");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">Two-factor verification</h1>
        <p className="text-muted-foreground text-sm text-balance">
          {useBackup
            ? "Enter one of your backup codes."
            : "Enter the 6-digit code from your authenticator app."}
        </p>
      </div>

      <div className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="code">{useBackup ? "Backup code" : "Code"}</Label>
          <Input
            id="code"
            inputMode={useBackup ? "text" : "numeric"}
            autoComplete="one-time-code"
            placeholder={useBackup ? "xxxxxxxxxx" : "123456"}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
            autoFocus
          />
        </div>

        {!useBackup && (
          <div className="flex items-center gap-2 py-1">
            <Switch
              id="trust-device"
              checked={trustDevice}
              onCheckedChange={setTrustDevice}
            />
            <Label htmlFor="trust-device" className="font-normal text-muted-foreground">
              Trust this device for 30 days
            </Label>
          </div>
        )}

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={pending || code.length === 0}>
          {pending ? "Verifying…" : "Verify"}
        </Button>

        <button
          type="button"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => {
            setUseBackup((v) => !v);
            setCode("");
            setError(null);
          }}
        >
          {useBackup ? "Use your authenticator app instead" : "Use a backup code instead"}
        </button>

        <Link
          href="/login"
          className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Back to login
        </Link>
      </div>
    </form>
  );
}
