// apps/web/src/components/metadata/metadata-value-input.tsx
"use client";

import { useState } from "react";
import { format, parse } from "date-fns";
import { FieldType } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

// Radix forbids "" as a SelectItem value, so the "None" (clear) option uses a
// sentinel that maps back to an empty value (which the save paths treat as a clear).
const NONE_VALUE = "__none__";

// Date-input calendar bounds: a wide year range so the month/year dropdowns let
// users jump to distant years without paging month-by-month. Module-level for a
// stable reference (the current year won't change within a session).
const DATE_PICKER_START = new Date(1900, 0);
const DATE_PICKER_END = new Date(new Date().getFullYear() + 10, 11);

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
      <Select
        value={value || undefined}
        onValueChange={(v) => {
          const next = v === NONE_VALUE ? "" : v;
          onChange(next);
          void onCommit?.(next);
        }}
      >
        <SelectTrigger
          size="sm"
          className="w-max justify-start gap-1 border-0 bg-transparent px-0 py-0 text-left text-xs shadow-none focus-visible:ring-0 data-[size=sm]:h-4 data-placeholder:text-muted-foreground/40"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value={NONE_VALUE} className="text-muted-foreground">
              None
            </SelectItem>
            {options.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }
  if (type === FieldType.Date) {
    return (
      <DateField value={value} placeholder={placeholder} onChange={onChange} onCommit={onCommit} />
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
        className="w-full resize-none border-0 bg-transparent p-0 text-left text-xs outline-none placeholder:text-muted-foreground/40"
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

/** Date fields edit via a shadcn calendar popover. The value is stored as
 *  `yyyy-MM-dd` (sortable, chronological as a string); the trigger shows it as
 *  "MMM d, yyyy". An unparseable legacy value is shown verbatim. */
function DateField({
  value,
  placeholder,
  onChange,
  onCommit,
}: Pick<MetadataValueInputProps, "value" | "placeholder" | "onChange" | "onCommit">) {
  const [open, setOpen] = useState(false);
  const date = toDate(value);

  function set(next: Date | undefined) {
    const v = next ? format(next, "yyyy-MM-dd") : "";
    onChange(v);
    void onCommit?.(v);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" className="h-4 w-full cursor-pointer text-left text-xs outline-none">
          {date ? (
            format(date, "MMM d, yyyy")
          ) : value ? (
            value
          ) : (
            <span className="text-muted-foreground/40">{placeholder}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-auto p-0">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          startMonth={DATE_PICKER_START}
          endMonth={DATE_PICKER_END}
          selected={date}
          defaultMonth={date}
          onSelect={set}
        />
        <div className="border-t p-1.5">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            disabled={!value}
            onClick={() => set(undefined)}
          >
            Clear
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Parse a stored value to a Date: prefer `yyyy-MM-dd` (local), else a loose
 *  `new Date` fallback; `undefined` when neither parses. */
function toDate(v: string): Date | undefined {
  if (!v) return undefined;
  const iso = parse(v, "yyyy-MM-dd", new Date());
  if (!Number.isNaN(iso.getTime())) return iso;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
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
    <div className="relative w-full">
      <input
        value={value}
        placeholder={placeholder}
        type={type === FieldType.Number ? "number" : "text"}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { void load(); setOpen(true); }}
        onBlur={() => { setTimeout(() => setOpen(false), 120); void onCommit?.(); }}
        className="block w-full border-0 bg-transparent p-0 text-left text-xs outline-none placeholder:text-muted-foreground/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      {open && suggests && matches.length > 0 && (
        <ul className="absolute left-0 z-30 mt-1 max-h-48 w-48 overflow-auto rounded-md border border-border bg-popover p-1 text-xs shadow-md">
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
