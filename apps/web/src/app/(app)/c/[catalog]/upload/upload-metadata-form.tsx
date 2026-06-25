"use client";

import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import { useCatalog } from "@/components/providers/catalog-context";
import { MetadataValueInput } from "@/components/metadata/metadata-value-input";
import { MetadataFieldsList } from "@/components/metadata/metadata-fields-list";

export function UploadMetadataForm({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);
  const groups = (schema ?? [])
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.enabled) }))
    .filter((g) => g.fields.length > 0);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">Metadata for this batch</p>
        <p className="text-xs text-muted-foreground">
          Applied to every photo you upload. Leave blank to skip.
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
    </div>
  );
}
