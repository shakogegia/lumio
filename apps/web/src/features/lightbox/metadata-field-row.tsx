// apps/web/src/features/lightbox/metadata-field-row.tsx
"use client";

import { useId, useRef, useState } from "react";
import { FieldType, MetadataValueSource, type ResolvedField } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";

export function MetadataFieldRow({
  slug,
  photoId,
  field,
}: {
  slug: string;
  photoId: string;
  field: ResolvedField;
}) {
  const listId = useId();
  const isExif = field.source === MetadataValueSource.Exif;
  // Show the user-entered value; for a standard field with only an EXIF value,
  // keep the input empty and show the EXIF value as the placeholder.
  const [value, setValue] = useState(isExif ? "" : (field.value ?? ""));
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const saved = useRef(isExif ? "" : (field.value ?? ""));

  async function loadSuggestions() {
    if (!field.suggests) return;
    try {
      const r = await fetch(
        catalogApiUrl(slug, `/metadata/suggest?field=${encodeURIComponent(field.id)}`),
      );
      if (r.ok) setSuggestions(((await r.json()) as { values: string[] }).values);
    } catch {
      /* suggestions are best-effort */
    }
  }

  async function save() {
    if (value === saved.current) return;
    saved.current = value;
    await fetch(catalogApiUrl(slug, `/metadata/photo/${photoId}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldId: field.id, value }),
    }).catch(() => {});
  }

  const placeholder = isExif && field.value ? field.value : "—";
  const common = {
    value,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValue(e.target.value),
    onFocus: loadSuggestions,
    onBlur: save,
    className:
      "w-40 rounded-md border border-transparent bg-transparent px-2 py-1 text-right text-sm hover:border-border focus:border-ring focus:bg-background focus:text-left focus:outline-none",
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{field.label}</span>
      <div className="flex items-center gap-1">
        {field.type === FieldType.Textarea ? (
          <textarea {...common} rows={2} className={common.className + " w-40 resize-none"} />
        ) : (
          <>
            <input
              {...common}
              type={field.type === FieldType.Number ? "number" : "text"}
              list={field.suggests ? listId : undefined}
            />
            {field.suggests && (
              <datalist id={listId}>
                {suggestions.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </>
        )}
      </div>
    </div>
  );
}
