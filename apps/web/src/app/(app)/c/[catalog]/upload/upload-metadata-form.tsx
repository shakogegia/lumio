"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import { useCatalog } from "@/components/providers/catalog-context";
import { MetadataValueInput } from "@/components/metadata/metadata-value-input";
import { MetadataFieldsList } from "@/components/metadata/metadata-fields-list";
import { Button } from "@/components/ui/button";
import { postJson } from "@/lib/http";
import { catalogApiUrl } from "@/lib/catalog-api";

export function UploadMetadataForm({
  values,
  onChange,
  selectedIds,
}: {
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  selectedIds: Set<string>;
}) {
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);
  const [busy, setBusy] = useState(false);

  const groups = (schema ?? [])
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.enabled) }))
    .filter((g) => g.fields.length > 0);
  if (groups.length === 0) return null;

  const filledValues = Object.entries(values).filter(([, v]) => v.trim() !== "");
  const canApply = selectedIds.size > 0 && filledValues.length > 0;

  async function handleApply() {
    if (!canApply || busy) return;
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/bulk"), {
        photoIds: [...selectedIds],
        values: filledValues.map(([fieldId, value]) => ({ fieldId, value })),
      });
      toast.success(`Updated ${selectedIds.size} photo${selectedIds.size === 1 ? "" : "s"}`);
    } catch {
      toast.error("Failed to apply metadata.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">Batch metadata</p>
        <p className="text-xs text-muted-foreground">
          Select photos below, fill fields, then apply.
        </p>
      </div>
      <MetadataFieldsList
        groups={groups}
        renderValue={(f) => (
          <MetadataValueInput
            slug={slug}
            fieldId={f.id}
            type={f.type}
            options={f.options}
            suggests={f.suggests}
            value={values[f.id] ?? ""}
            onChange={(v) => onChange({ ...values, [f.id]: v })}
          />
        )}
      />
      <Button
        className="w-full"
        disabled={!canApply || busy}
        onClick={() => void handleApply()}
      >
        {busy ? (
          <Loader2 className="mr-2 animate-spin" aria-hidden />
        ) : null}
        Apply to {selectedIds.size}
      </Button>
    </div>
  );
}
