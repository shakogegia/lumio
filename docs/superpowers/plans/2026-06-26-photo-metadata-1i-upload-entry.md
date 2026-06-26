# Photo Metadata 1i — Upload-Time Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** When uploading a batch (a roll), fill the catalog's custom metadata once and have it applied to every photo as it's ingested — with the same prior-value autocomplete used in the Info tab.

**Architecture:** Extract the Info-tab fill input into a reusable `MetadataValueInput` (choice → Select, textarea, else autocomplete-from-prior-values). The upload page shows a "Metadata for this batch" form (custom fields from the cached schema) and threads the filled values through each file's upload POST as a `metadata` form field; the uploads route writes them via `upsertPhotoMetadataValue` right after a photo is `added`. No DB migration, no bulk endpoint.

**Tech Stack:** React client, the cached `useCatalogMetadataSchema` hook, `upsertPhotoMetadataValue` (existing), the existing upload flow.

---

## File structure
- Create `apps/web/src/components/metadata/metadata-value-input.tsx` — reusable input.
- Modify `apps/web/src/features/lightbox/metadata-field-row.tsx` — use the shared input.
- Modify `apps/web/src/app/api/c/[catalog]/metadata/.../` — none; modify the **uploads** route: `apps/web/src/app/api/c/[catalog]/uploads/route.ts`.
- Modify `apps/web/src/app/(app)/c/[catalog]/upload/upload-client.tsx` — batch form + thread values.
- Create `apps/web/src/app/(app)/c/[catalog]/upload/upload-metadata-form.tsx` — the batch form.

---

### Task 1: Extract `MetadataValueInput`

**Files:** Create `apps/web/src/components/metadata/metadata-value-input.tsx`; modify `metadata-field-row.tsx`.

- [ ] **Step 1: Create the shared component** by moving the three input branches out of `metadata-field-row.tsx` (the choice `Select`, the `textarea`, and the autocomplete `AutocompleteInput`) into one component:

```tsx
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
        <SelectTrigger size="sm" className="w-40"><SelectValue placeholder={placeholder} /></SelectTrigger>
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
        className="w-40 resize-none rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
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
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
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
```

- [ ] **Step 2: Refactor `metadata-field-row.tsx`** to render `<MetadataValueInput slug fieldId={field.id} type={field.type} options={field.options} suggests={field.suggests} value={value} placeholder={placeholder} onChange={setValue} onCommit={save} />` in place of its inline choice/textarea/autocomplete branches. (The right-aligned Info-tab styling differs slightly from the shared input's left-aligned style — acceptable; keep the shared style for consistency.) Remove the now-dead `Select`/autocomplete code + unused imports from `metadata-field-row.tsx`.

- [ ] **Step 3:** Typecheck web. Commit.

```bash
git add apps/web/src/components/metadata/metadata-value-input.tsx apps/web/src/features/lightbox/metadata-field-row.tsx
git commit -m "feat(metadata): extract reusable MetadataValueInput (choice/textarea/autocomplete)"
```

---

### Task 2: Uploads route writes batch metadata

**Files:** `apps/web/src/app/api/c/[catalog]/uploads/route.ts`.

- [ ] **Step 1:** After the existing `handleUpload(...)` call, when the result is `added`, parse the `metadata` form field and write each non-empty value (best-effort — never fail the upload over metadata). Add imports `FeatureKey` from `@lumio/shared` and `isFeatureEnabled, upsertPhotoMetadataValue` from `@lumio/db`.

```ts
  // …existing: const result = await handleUpload(...);
  if (result.status === "added") {
    const metaRaw = form.get("metadata");
    if (typeof metaRaw === "string" && metaRaw && (await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
      try {
        const values = JSON.parse(metaRaw) as Array<{ fieldId?: unknown; value?: unknown }>;
        for (const v of values) {
          if (typeof v.fieldId === "string" && typeof v.value === "string" && v.value.trim()) {
            await upsertPhotoMetadataValue(result.id, v.fieldId, v.value).catch(() => {});
          }
        }
      } catch {
        /* malformed metadata — ignore, the photo is already added */
      }
    }
  }
  // …existing return NextResponse.json(result, { status: code });
```

(`result.id` exists on the `added` branch. Keep the existing `code`/return.)

- [ ] **Step 2:** Typecheck web. Commit.

```bash
git add "apps/web/src/app/api/c/[catalog]/uploads/route.ts"
git commit -m "feat(metadata): persist batch metadata on upload"
```

---

### Task 3: Batch metadata form on the upload page

**Files:** Create `…/upload/upload-metadata-form.tsx`; modify `upload-client.tsx`.

- [ ] **Step 1: The form** — shown only when the catalog has custom fields; collects a value per field; lifts them up via `onChange`.

```tsx
// apps/web/src/app/(app)/c/[catalog]/upload/upload-metadata-form.tsx
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
```

- [ ] **Step 2: Wire into `upload-client.tsx`:**
  - Add state: `const [metaValues, setMetaValues] = useState<Record<string, string>>({});`
  - Render `<UploadMetadataForm values={metaValues} onChange={setMetaValues} />` near the top of the upload area (e.g., above `<UploadDropzone />`). Import it + use a ref so the latest values are read at upload time (state in a `useCallback` closure can go stale — mirror how the file handles other state, or read from a `metaRef` updated alongside `setMetaValues`).
  - In `uploadOne`, attach the filled values to the POST body **before** the fetch:

```tsx
    const filled = Object.entries(metaRef.current).filter(([, v]) => v.trim() !== "");
    if (filled.length > 0) {
      body.set("metadata", JSON.stringify(filled.map(([fieldId, value]) => ({ fieldId, value }))));
    }
```

  Add `const metaRef = useRef<Record<string, string>>({});` and keep it in sync: `const setMeta = (next) => { metaRef.current = next; setMetaValues(next); }` and pass `setMeta` to the form's `onChange`. (`uploadOne` is a `useCallback`; reading `metaRef.current` avoids a stale closure without adding it to deps.)

- [ ] **Step 3:** Typecheck web. Commit.

```bash
git add "apps/web/src/app/(app)/c/[catalog]/upload/upload-metadata-form.tsx" "apps/web/src/app/(app)/c/[catalog]/upload/upload-client.tsx"
git commit -m "feat(metadata): fill metadata for a batch at upload time"
```

---

### Task 4: Verify
- [ ] `pnpm --filter @lumio/web exec tsc --noEmit` → clean.
- [ ] **Browser smoke** (controller): on a catalog with custom fields, open Upload → a "Metadata for this batch" form shows (with autocomplete) → fill Film Stock + Camera → drop a few files → after upload, open each new photo's Info tab and confirm the values were applied. With no custom fields (or feature off), the form is absent.

## Self-review
- **Spec coverage:** fill metadata once at upload → applied to all photos in the batch ✓; reuses the prior-value autocomplete ✓; best-effort (never fails an upload) ✓; gated ✓.
- **Type consistency:** `MetadataValueInput` props match both call sites; `upsertPhotoMetadataValue(photoId, fieldId, value)` matches; the `metadata` form field round-trips as `{fieldId,value}[]`.

## Next: Phase 2 — `@field op value` search + smart albums over metadata (salvages PR #68's engine).
