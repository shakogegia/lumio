// apps/web/src/features/lightbox/metadata-field-row.tsx
"use client";

import { useRef, useState } from "react";
import { FieldType, MetadataValueSource, type ResolvedField } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
        {field.type === FieldType.Choice && field.options.length > 0 ? (
          <Select value={value || undefined} onValueChange={(v) => { setValue(v); void save(v); }}>
            <SelectTrigger size="sm" className="w-40">
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {field.options.map((o) => (
                  <SelectItem key={o} value={o}>{o}</SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : field.type === FieldType.Textarea ? (
          <textarea
            value={value}
            placeholder={placeholder}
            rows={2}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => void save()}
            className="w-40 resize-none rounded-md border border-transparent bg-transparent px-2 py-1 text-right text-sm hover:border-border focus:border-ring focus:bg-background focus:text-left focus:outline-none"
          />
        ) : (
          <AutocompleteInput
            slug={slug}
            field={field}
            value={value}
            placeholder={placeholder}
            onChange={setValue}
            onCommit={save}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Text/number input that suggests the user's previously-entered values for this
 * field (from any photo) as a real dropdown — type "ko" and "Kodak Portra 400"
 * shows up. Suggestions load on focus; selecting commits immediately.
 */
function AutocompleteInput({
  slug,
  field,
  value,
  placeholder,
  onChange,
  onCommit,
}: {
  slug: string;
  field: ResolvedField;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onCommit: (next?: string) => void | Promise<void>;
}) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  async function load() {
    if (!field.suggests) return;
    try {
      const r = await fetch(
        catalogApiUrl(slug, `/metadata/suggest?field=${encodeURIComponent(field.id)}`),
      );
      if (r.ok) setSuggestions(((await r.json()) as { values: string[] }).values);
    } catch {
      /* best-effort */
    }
  }

  const q = value.trim().toLowerCase();
  const matches = (q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions)
    .filter((s) => s !== value)
    .slice(0, 8);

  function pick(s: string) {
    onChange(s);
    void onCommit(s);
    setOpen(false);
  }

  return (
    <div className="relative w-40">
      <input
        value={value}
        placeholder={placeholder}
        type={field.type === FieldType.Number ? "number" : "text"}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { void load(); setOpen(true); }}
        // Delay so a suggestion click registers before the dropdown closes.
        onBlur={() => { setTimeout(() => setOpen(false), 120); void onCommit(); }}
        className="w-full rounded-md border border-transparent bg-transparent px-2 py-1 text-right text-sm hover:border-border focus:border-ring focus:bg-background focus:text-left focus:outline-none"
      />
      {open && field.suggests && matches.length > 0 && (
        <ul className="absolute right-0 z-30 mt-1 max-h-48 w-48 overflow-auto rounded-md border border-border bg-popover p-1 text-sm shadow-md">
          {matches.map((s) => (
            <li key={s}>
              <button
                type="button"
                // mousedown fires before the input's blur — prevent default so
                // focus stays put and onClick can run the selection.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(s)}
                className="block w-full truncate rounded px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
