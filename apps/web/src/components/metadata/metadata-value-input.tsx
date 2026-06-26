// apps/web/src/components/metadata/metadata-value-input.tsx
"use client";

import { useState } from "react";
import { FieldType } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export interface MetadataValueInputProps {
  slug: string;
  fieldId: string;
  type: FieldType;
  options: string[];
  suggests: boolean;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  /** Called when the value is "committed" (blur / pick / select). Optional —
   *  the upload form just collects, the Info tab saves. */
  onCommit?: (next?: string) => void | Promise<void>;
}

export function MetadataValueInput({
  slug, fieldId, type, options, suggests, value, placeholder = "—", onChange, onCommit,
}: MetadataValueInputProps) {
  if (type === FieldType.Choice && options.length > 0) {
    return (
      <Select value={value || undefined} onValueChange={(v) => { onChange(v); void onCommit?.(v); }}>
        <SelectTrigger
          size="sm"
          className="h-auto w-40 justify-end gap-1 border-0 bg-transparent px-0 py-0 text-right shadow-none focus-visible:ring-0"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }
  if (type === FieldType.Textarea) {
    return (
      <textarea
        value={value}
        placeholder={placeholder}
        rows={2}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => void onCommit?.()}
        className="w-40 resize-none border-0 bg-transparent p-0 text-right text-sm outline-none placeholder:text-muted-foreground"
      />
    );
  }
  return (
    <Autocomplete
      slug={slug} fieldId={fieldId} type={type} suggests={suggests}
      value={value} placeholder={placeholder} onChange={onChange} onCommit={onCommit}
    />
  );
}

function Autocomplete({
  slug, fieldId, type, suggests, value, placeholder, onChange, onCommit,
}: Omit<MetadataValueInputProps, "options">) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  async function load() {
    if (!suggests) return;
    try {
      const r = await fetch(catalogApiUrl(slug, `/metadata/suggest?field=${encodeURIComponent(fieldId)}`));
      if (r.ok) setSuggestions(((await r.json()) as { values: string[] }).values);
    } catch { /* best-effort */ }
  }
  const q = value.trim().toLowerCase();
  const matches = (q ? suggestions.filter((s) => s.toLowerCase().includes(q)) : suggestions)
    .filter((s) => s !== value).slice(0, 8);
  function pick(s: string) { onChange(s); void onCommit?.(s); setOpen(false); }
  return (
    <div className="relative w-40">
      <input
        value={value}
        placeholder={placeholder}
        type={type === FieldType.Number ? "number" : "text"}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { void load(); setOpen(true); }}
        onBlur={() => { setTimeout(() => setOpen(false), 120); void onCommit?.(); }}
        className="w-full border-0 bg-transparent p-0 text-right text-sm outline-none placeholder:text-muted-foreground"
      />
      {open && suggests && matches.length > 0 && (
        <ul className="absolute right-0 z-30 mt-1 max-h-48 w-48 overflow-auto rounded-md border border-border bg-popover p-1 text-sm shadow-md">
          {matches.map((s) => (
            <li key={s}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(s)}
                className="block w-full truncate rounded px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground">{s}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
