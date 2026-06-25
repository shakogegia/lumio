// apps/web/src/features/lightbox/metadata-field-row.tsx
"use client";

import { useRef, useState } from "react";
import { MetadataValueSource, type ResolvedField } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import { MetadataValueInput } from "@/components/metadata/metadata-value-input";

/**
 * The value slot for one custom field in the Info tab: an editable input
 * (autocomplete / choice / textarea) that saves per-photo on commit. The field
 * label + row layout live in the shared `MetadataFieldsList`.
 */
export function MetadataValueField({
  slug,
  photoId,
  field,
}: {
  slug: string;
  photoId: string;
  field: ResolvedField;
}) {
  const isExif = field.source === MetadataValueSource.Exif;
  // Show the user-entered value; a standard field with only an EXIF value keeps
  // the input empty and shows the EXIF value as the placeholder.
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

  return (
    <MetadataValueInput
      slug={slug}
      fieldId={field.id}
      type={field.type}
      options={field.options}
      suggests={field.suggests}
      value={value}
      placeholder={isExif && field.value ? field.value : "—"}
      onChange={setValue}
      onCommit={save}
    />
  );
}
