"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <form onSubmit={(e) => void handleSubmit(e)} className="w-full max-w-sm space-y-4 text-center">
        <Lock className="mx-auto size-8 text-muted-foreground/70" aria-hidden />
        <h1 className="text-xl font-semibold tracking-tight">{title ?? "Protected gallery"}</h1>
        <p className="text-sm text-muted-foreground">Enter the password to view these photos.</p>
        <div className="space-y-1.5 text-left">
          <Label htmlFor="share-password">Password</Label>
          <Input
            id="share-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            Incorrect password.
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending || !password}>
          {pending ? "Unlocking…" : "View gallery"}
        </Button>
      </form>
    </main>
  );
}
