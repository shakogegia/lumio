"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FeatureKey } from "@lumio/shared";
import type { GlobalFeatureState } from "@lumio/db";
import { Switch } from "@/components/ui/switch";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";

export function GlobalFeaturesForm({ initial }: { initial: GlobalFeatureState[] }) {
  const router = useRouter();
  const [states, setStates] = useState(initial);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function toggle(key: FeatureKey, next: boolean) {
    setStates((s) => s.map((f) => (f.key === key ? { ...f, enabled: next } : f)));
    setErrorKey(null);
    setSavingKey(key);
    try {
      const res = await fetch("/api/features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, catalogId: null, enabled: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setStates((s) => s.map((f) => (f.key === key ? { ...f, enabled: !next } : f)));
      setErrorKey(key);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {states.map((f) => (
        <Field key={f.key} orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`feature-${f.key}`}>{f.label}</FieldLabel>
            <FieldDescription>{f.description}</FieldDescription>
            {errorKey === f.key && <FieldError>Couldn&apos;t save — try again.</FieldError>}
          </FieldContent>
          <Switch
            id={`feature-${f.key}`}
            checked={f.enabled}
            onCheckedChange={(v) => toggle(f.key, v)}
            disabled={savingKey === f.key}
          />
        </Field>
      ))}
    </div>
  );
}
