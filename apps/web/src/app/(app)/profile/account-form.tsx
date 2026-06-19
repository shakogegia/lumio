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
