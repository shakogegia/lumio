"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FeatureKey } from "@lumio/shared";
import type { CatalogFeatureState } from "@lumio/db";
import { postJson } from "@/lib/http";
import { apiPaths } from "@/lib/api-paths";
import { Switch } from "@/components/ui/switch";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";

export function CatalogFeaturesForm({
  catalogId,
  initial,
}: {
  catalogId: string;
  initial: CatalogFeatureState[];
}) {
  const router = useRouter();
  const [states, setStates] = useState(initial);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function toggle(key: FeatureKey, next: boolean) {
    setStates((s) => s.map((f) => (f.key === key ? { ...f, catalogEnabled: next } : f)));
    setErrorKey(null);
    setSavingKey(key);
    try {
      await postJson(apiPaths.features, { key, catalogId, enabled: next }, "PUT");
      router.refresh();
    } catch {
      setStates((s) => s.map((f) => (f.key === key ? { ...f, catalogEnabled: !next } : f)));
      setErrorKey(key);
    } finally {
      setSavingKey(null);
    }
  }

  if (states.length === 0) {
    return <p className="text-sm text-muted-foreground">No per-catalog features yet.</p>;
  }

  return (
    <div className="space-y-6">
      {states.map((f) => (
        <Field key={f.key} orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`catfeature-${f.key}`}>{f.label}</FieldLabel>
            <FieldDescription>
              {f.globalEnabled
                ? f.description
                : "Turn this feature on globally (Settings → Features) to use it here."}
            </FieldDescription>
            {errorKey === f.key && <FieldError>Couldn&apos;t save — try again.</FieldError>}
          </FieldContent>
          <Switch
            id={`catfeature-${f.key}`}
            checked={f.globalEnabled && f.catalogEnabled}
            onCheckedChange={(v) => toggle(f.key, v)}
            disabled={!f.globalEnabled || savingKey === f.key}
          />
        </Field>
      ))}
    </div>
  );
}
