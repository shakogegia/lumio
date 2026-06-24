"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";

export function LoginForm({ className }: { className?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [passkeyPending, setPasskeyPending] = useState(false);

  // Conditional UI: if the browser supports it, kick off a background passkey
  // request so saved passkeys surface in the email field's autofill dropdown.
  // It resolves only when the user picks one; otherwise it sits idle and the
  // explicit button below still works. No synchronous setState here (the
  // navigation happens in the async success callback).
  useEffect(() => {
    let cancelled = false;
    async function preloadConditionalUi() {
      try {
        if (
          typeof PublicKeyCredential === "undefined" ||
          !PublicKeyCredential.isConditionalMediationAvailable ||
          !(await PublicKeyCredential.isConditionalMediationAvailable()) ||
          cancelled
        ) {
          return;
        }
        await signIn.passkey({
          autoFill: true,
          fetchOptions: {
            onSuccess() {
              router.replace("/");
            },
          },
        });
      } catch {
        // Conditional mediation unsupported or aborted — ignore.
      }
    }
    void preloadConditionalUi();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onPasskey() {
    setError(null);
    setPasskeyPending(true);
    try {
      // A passkey is a complete, phishing-resistant factor, so this resolves
      // straight to a session — no twoFactorRedirect / TOTP step.
      const { error } = await signIn.passkey();
      if (error) {
        setError(error.message ?? "Passkey sign-in failed.");
        return;
      }
      router.replace("/");
    } catch {
      setError(
        "Passkey sign-in was cancelled or isn’t supported on this device.",
      );
    } finally {
      setPasskeyPending(false);
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    try {
      const form = new FormData(e.currentTarget);
      const { data, error } = await signIn.email({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if (error) {
        setError(error.message ?? "Invalid email or password.");
        return;
      }
      // With 2FA enabled, no session is created yet — go verify the second factor.
      if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
        router.replace("/two-factor");
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
    <form onSubmit={onSubmit} className={cn("flex flex-col gap-6", className)}>
      <div className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-2xl font-semibold">Welcome back</h1>
        <p className="text-muted-foreground text-sm text-balance">
          Sign in to your Lumio library.
        </p>
      </div>
      <div className="grid gap-3">
        <div className="grid gap-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email webauthn"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="w-full"
          disabled={pending || passkeyPending}
        >
          {pending ? "Signing in…" : "Login"}
        </Button>

        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-foreground/10" />
          <span className="text-muted-foreground text-xs">or</span>
          <span className="h-px flex-1 bg-foreground/10" />
        </div>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending || passkeyPending}
          onClick={onPasskey}
        >
          <KeyRound />
          {passkeyPending ? "Waiting for your device…" : "Sign in with a passkey"}
        </Button>
      </div>
    </form>
  );
}
