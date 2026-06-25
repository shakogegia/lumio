"use client";

import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import { useCatalog } from "@/components/providers/catalog-context";
import { MetadataValueInput } from "@/components/metadata/metadata-value-input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export function UploadMetadataForm({
  values,
  onChange,
}: {
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);
  const groups = (schema ?? []).map((g) => ({ ...g, fields: g.fields.filter((f) => f.enabled) })).filter((g) => g.fields.length > 0);
  if (groups.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Metadata for this batch</CardTitle>
        <CardDescription>Applied to every photo you upload below. Leave blank to skip.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map((group) => (
          <div key={group.id} className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
            {group.fields.map((f) => (
              <div key={f.id} className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-sm text-muted-foreground">{f.label}</span>
                <MetadataValueInput
                  slug={slug}
                  fieldId={f.id}
                  type={f.type}
                  options={f.options}
                  suggests={f.suggests}
                  value={values[f.id] ?? ""}
                  onChange={(v) => onChange({ ...values, [f.id]: v })}
                />
              </div>
            ))}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
