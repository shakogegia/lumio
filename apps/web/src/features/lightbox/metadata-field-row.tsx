// apps/web/src/features/lightbox/metadata-field-row.tsx
"use client";

import { useRef, useState } from "react";
import { MetadataValueSource, type ResolvedField } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import { MetadataValueInput } from "@/components/metadata/metadata-value-input";

export function MetadataFieldRow({
  slug,
  photoId,
  field,
}: {
  slug: string;
  photoId: string;
  field: ResolvedField;
}) {
  const isExif = field.source === MetadataValueSource.Exif;
  // Show the user-entered value; for a standard field with only an EXIF value,
  // keep the input empty and show the EXIF value as the placeholder.
  const [value, setValue] = useState(isExif ? "" : (field.value ?? ""));
  const saved = useRef(isExif ? "" : (field.value ?? ""));

  async function save(next: string = value) {
    if (next === saved.current) return;
    saved.current = next;
    await fetch(catalogApiUrl(slug, `/metadata/photo/${photoId}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldId: field.id, value: next }),
    }).catch(() => {});
  }

  const placeholder = isExif && field.value ? field.value : "—";

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{field.label}</span>
      <div className="flex items-center gap-1">
        <MetadataValueInput
          slug={slug}
          fieldId={field.id}
          type={field.type}
          options={field.options}
          suggests={field.suggests}
          value={value}
          placeholder={placeholder}
          onChange={setValue}
          onCommit={save}
        />
      </div>
    </div>
  );
}
