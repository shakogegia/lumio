"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "react-qr-code";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackupCodes } from "./backup-codes";

type Enrollment = { totpURI: string; backupCodes: string[] };

/** Pulls the human-typable secret out of an otpauth:// URI for manual entry. */
function secretFromUri(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

export function TwoFactorEnable() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function startEnable(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { data, error } = await authClient.twoFactor.enable({ password });
      if (error || !data) {
        setError(error?.message ?? "Could not start two-factor setup.");
        return;
      }
      setEnrollment({ totpURI: data.totpURI, backupCodes: data.backupCodes });
      setPassword("");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  async function verify(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const { error } = await authClient.twoFactor.verifyTotp({ code });
      if (error) {
        setError(error.message ?? "That code didn’t work. Try again.");
        return;
      }
      // twoFactorEnabled is now true; re-render the server component to swap to
      // the "manage" view.
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (!enrollment) {
    return (
      <form onSubmit={startEnable} className="grid max-w-sm gap-3">
        <p className="text-sm text-muted-foreground">
          Two-factor authentication is <strong>off</strong>. Confirm your
          password to begin setup with an authenticator app.
        </p>
        <div className="grid gap-2">
          <Label htmlFor="tf-enable-password">Current password</Label>
          <Input
            id="tf-enable-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending || password.length === 0} className="w-fit">
          {pending ? "Starting…" : "Enable two-factor"}
        </Button>
      </form>
    );
  }

  const secret = secretFromUri(enrollment.totpURI);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Scan this QR code with your authenticator app (1Password, Google
          Authenticator, etc.), then enter the 6-digit code it shows.
        </p>
        <div className="inline-block rounded-lg bg-white p-3">
          <QRCode value={enrollment.totpURI} size={160} />
        </div>
        {secret && (
          <p className="text-xs text-muted-foreground">
            Or enter this key manually:{" "}
            <span className="font-mono break-all">{secret}</span>
          </p>
        )}
      </div>

      <BackupCodes codes={enrollment.backupCodes} />

      <form onSubmit={verify} className="grid max-w-sm gap-3">
        <div className="grid gap-2">
          <Label htmlFor="tf-verify-code">Verification code</Label>
          <Input
            id="tf-verify-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending || code.length === 0} className="w-fit">
          {pending ? "Verifying…" : "Verify & turn on"}
        </Button>
      </form>
    </div>
  );
}
