"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";

export function SharePasswordGate({ token, title }: { token: string; title: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !password) return;
    setPending(true);
    setError(false);
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col p-6 md:p-10">
      {/* Brand top-left, mirroring the login/setup layout. */}
      <div className="flex items-center gap-2 font-medium">
        <Logo className="size-5" /> Lumio
      </div>
      <div className="flex flex-1 items-center justify-center">
        <form onSubmit={(e) => void handleSubmit(e)} className="w-full max-w-sm space-y-6">
          <div className="space-y-2 text-center">
            <Lock className="mx-auto size-8 text-muted-foreground/70" aria-hidden />
            <h1 className="text-xl font-semibold tracking-tight">{title ?? "Protected gallery"}</h1>
            <p className="text-sm text-muted-foreground">Enter the password to view these photos.</p>
          </div>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="share-password">Password</FieldLabel>
            <Input
              id="share-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              aria-invalid={error ? true : undefined}
            />
            {error && <FieldError>Incorrect password.</FieldError>}
          </Field>
          <Button type="submit" className="w-full" disabled={pending || !password}>
            {pending ? "Unlocking…" : "View gallery"}
          </Button>
        </form>
      </div>
    </main>
  );
}
