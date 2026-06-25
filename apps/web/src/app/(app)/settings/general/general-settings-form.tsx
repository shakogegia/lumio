"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiPaths } from "@/lib/api-paths";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GeneralSettingsForm({ initial }: { initial: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(apiPaths.settingsGeneral, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicBaseUrl: value.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(typeof data?.error === "string" ? data.error : "Failed to save");
        return;
      }
      const data = (await res.json()) as { publicBaseUrl: string | null };
      setValue(data.publicBaseUrl ?? "");
      toast.success("Saved");
      router.refresh();
    } catch {
      setError("Failed to save");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="public-base-url">Public base URL</Label>
        <Input
          id="public-base-url"
          placeholder="https://photos.example.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
