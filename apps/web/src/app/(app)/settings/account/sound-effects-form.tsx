"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setSoundEnabled } from "@/lib/sound/player";
import { postJson } from "@/lib/http";
import { Switch } from "@/components/ui/switch";
import { Field, FieldContent, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";

export function SoundEffectsForm({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);

  async function toggle(next: boolean) {
    // Optimistic: flip the UI and the live player immediately.
    setEnabled(next);
    setSoundEnabled(next);
    setError(false);
    setSaving(true);
    try {
      await postJson("/api/profile", { soundEffectsEnabled: next }, "PUT");
      router.refresh();
    } catch {
      // Revert UI + player on failure.
      setEnabled(!next);
      setSoundEnabled(!next);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="soundEffects">Sound effects</FieldLabel>
        <FieldDescription>
          Play a sound when moving photos to Trash, emptying Trash, or deleting
          permanently.
        </FieldDescription>
        {error && <FieldError>Couldn&apos;t save — try again.</FieldError>}
      </FieldContent>
      <Switch id="soundEffects" checked={enabled} onCheckedChange={toggle} disabled={saving} />
    </Field>
  );
}
