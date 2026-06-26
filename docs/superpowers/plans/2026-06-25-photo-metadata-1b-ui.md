# Photo Metadata 1b-ui — API + Info-tab Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make custom metadata visible and editable: gated catalog-scoped API routes over the 1b-core DB layer, plus an Info-tab section that shows the resolved fields, lets you fill them inline with autocomplete, and offers a "Set up → Film / Digital" empty-state.

**Architecture:** Five thin `withCatalog` + `isFeatureEnabled` API routes wrap the already-tested `@lumio/db` metadata layer. A client `MetadataPanel` (in the lightbox Info tab, behind `FeatureGate`) fetches the catalog schema; if empty it shows preset buttons (POST apply-preset), otherwise it fetches the photo's resolved groups (`GET …/photo/[id]`) and renders each field as a `MetadataFieldRow` — a text/textarea input with a native `<datalist>` fed by `GET …/suggest`, saving via `PUT`. Spec: `docs/superpowers/specs/2026-06-25-photo-metadata-design.md`. Builds on 1b-core (migration already applied to the dev DB).

**Tech Stack:** Next.js 16 route handlers, React 19 client components, `@lumio/db` (DI layer), `@lumio/shared` (`resolvePhotoMetadata`, presets, `FeatureKey`), lucide-react, Tailwind. The web package has **no React render-test harness** (vitest node env) — UI is verified by `tsc` + browser smoke.

---

## File structure

- Create `apps/web/src/app/api/c/[catalog]/metadata/schema/route.ts` — GET catalog schema.
- Create `apps/web/src/app/api/c/[catalog]/metadata/apply-preset/route.ts` — POST apply a built-in preset.
- Create `apps/web/src/app/api/c/[catalog]/metadata/photo/[id]/route.ts` — GET resolved groups; PUT a field value.
- Create `apps/web/src/app/api/c/[catalog]/metadata/suggest/route.ts` — GET autocomplete values.
- Create `apps/web/src/features/lightbox/metadata-field-row.tsx` — one inline-editable field.
- Create `apps/web/src/features/lightbox/metadata-panel.tsx` — the Info-tab section.
- Modify `apps/web/src/features/lightbox/lightbox-sidebar.tsx` — mount `<MetadataPanel>` (gated) in the Info tab.

All routes start with `export const runtime = "nodejs";` and `export const dynamic = "force-dynamic";` and gate with `isFeatureEnabled(catalog.id, FeatureKey.Metadata)` (404 when off).

---

### Task 1: API routes

**Files:** the four route files above.

- [ ] **Step 1: `schema/route.ts`**

```ts
// apps/web/src/app/api/c/[catalog]/metadata/schema/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { getCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (_request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  return NextResponse.json({ schema: await getCatalogSchema(catalog.id) });
});
```

- [ ] **Step 2: `apply-preset/route.ts`** (replace-when-empty per spec decision #2; 409 otherwise)

```ts
// apps/web/src/app/api/c/[catalog]/metadata/apply-preset/route.ts
import { NextResponse } from "next/server";
import { FeatureKey, getPreset } from "@lumio/shared";
import { applyMetadataPreset, getCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { presetId?: string } | null;
  const preset = body?.presetId ? getPreset(body.presetId) : undefined;
  if (!preset) return NextResponse.json({ error: "Unknown preset" }, { status: 400 });

  const existing = await getCatalogSchema(catalog.id);
  if (existing.length > 0) {
    return NextResponse.json({ error: "Schema is not empty" }, { status: 409 });
  }
  await applyMetadataPreset(catalog.id, preset);
  return NextResponse.json({ schema: await getCatalogSchema(catalog.id) }, { status: 201 });
});
```

- [ ] **Step 3: `photo/[id]/route.ts`** (GET resolved + PUT value)

```ts
// apps/web/src/app/api/c/[catalog]/metadata/photo/[id]/route.ts
import { NextResponse } from "next/server";
import { FeatureKey, resolvePhotoMetadata } from "@lumio/shared";
import {
  getCatalogSchema,
  getPhotoMetadataValues,
  isFeatureEnabled,
  upsertPhotoMetadataValue,
} from "@lumio/db";
import { getPhoto } from "@/lib/server/photos-service";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog<{ id: string }>(async (_request, context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  const { id } = await context.params;
  const photo = await getPhoto(catalog.id, id);
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const [schema, values] = await Promise.all([
    getCatalogSchema(catalog.id),
    getPhotoMetadataValues(id),
  ]);
  return NextResponse.json({ groups: resolvePhotoMetadata(schema, values, photo.exif) });
});

export const PUT = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as
    | { fieldId?: string; value?: string }
    | null;
  if (!body?.fieldId || typeof body.value !== "string") {
    return NextResponse.json({ error: "fieldId and value are required" }, { status: 400 });
  }
  // Only allow writing fields that belong to this catalog.
  const schema = await getCatalogSchema(catalog.id);
  const known = schema.some((g) => g.fields.some((f) => f.id === body.fieldId));
  if (!known) return NextResponse.json({ error: "Unknown field" }, { status: 400 });

  await upsertPhotoMetadataValue(id, body.fieldId, body.value);
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 4: `suggest/route.ts`**

```ts
// apps/web/src/app/api/c/[catalog]/metadata/suggest/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { isFeatureEnabled, suggestFieldValues } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ values: [] });
  }
  const url = new URL(request.url);
  const field = url.searchParams.get("field");
  const q = url.searchParams.get("q") ?? "";
  if (!field) return NextResponse.json({ error: "field is required" }, { status: 400 });
  return NextResponse.json({ values: await suggestFieldValues(field, q) });
});
```

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @lumio/web exec tsc --noEmit` (expect no new errors; pre-existing only).

```bash
git add "apps/web/src/app/api/c/[catalog]/metadata"
git commit -m "feat(metadata): gated catalog API routes (schema, apply-preset, photo values, suggest)"
```

---

### Task 2: `MetadataFieldRow` — inline-editable field with autocomplete

**Files:** Create `apps/web/src/features/lightbox/metadata-field-row.tsx`

Native `<datalist>` gives accessible autocomplete with no custom dropdown. Suggestions load once on focus (the browser filters as you type). Standard fields show their EXIF-derived value as a placeholder; typing a value overrides it.

- [ ] **Step 1: Write the component**

```tsx
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
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`

```bash
git add apps/web/src/features/lightbox/metadata-field-row.tsx
git commit -m "feat(metadata): inline-editable metadata field row with datalist autocomplete"
```

---

### Task 3: `MetadataPanel` — fetch, empty-state, render

**Files:** Create `apps/web/src/features/lightbox/metadata-panel.tsx`

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/features/lightbox/metadata-panel.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { PhotoDTO, ResolvedGroup } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { MetadataFieldRow } from "./metadata-field-row";

export function MetadataPanel({ photo }: { photo: PhotoDTO }) {
  const { slug } = useCatalog();
  const [groups, setGroups] = useState<ResolvedGroup[] | null>(null);
  const [hasSchema, setHasSchema] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(catalogApiUrl(slug, `/metadata/photo/${photo.id}`));
    if (!r.ok) {
      setHasSchema(false);
      setGroups([]);
      return;
    }
    const data = (await r.json()) as { groups: ResolvedGroup[] };
    setGroups(data.groups);
    setHasSchema(data.groups.length > 0);
  }, [slug, photo.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyPreset(presetId: string) {
    setBusy(true);
    try {
      await fetch(catalogApiUrl(slug, "/metadata/apply-preset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (hasSchema === null) return null; // first load

  if (!hasSchema) {
    return (
      <div className="space-y-2">
        <p className="font-medium">Metadata</p>
        <p className="text-xs text-muted-foreground">
          Start from a preset — you can edit the fields afterwards.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => applyPreset("film")}>
            Film
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => applyPreset("digital")}>
            Digital
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(groups ?? [])
        .filter((g) => g.fields.length > 0)
        .map((group) => (
          <div key={group.id} className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
            {group.fields.map((field) => (
              <MetadataFieldRow key={field.id} slug={slug} photoId={photo.id} field={field} />
            ))}
          </div>
        ))}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`

```bash
git add apps/web/src/features/lightbox/metadata-panel.tsx
git commit -m "feat(metadata): Info-tab MetadataPanel (schema fetch, preset empty-state, grouped rows)"
```

---

### Task 4: Mount the panel in the Info tab (gated)

**Files:** Modify `apps/web/src/features/lightbox/lightbox-sidebar.tsx`

- [ ] **Step 1: Add imports** (top of file)

```tsx
import { FeatureKey } from "@lumio/shared";
import { FeatureGate } from "@/components/features/features-provider";
import { MetadataPanel } from "./metadata-panel";
```

(Confirmed: `FeatureGate({ feature, children })` and `useFeature(key)` are exported from `@/components/features/features-provider`.)

- [ ] **Step 2: Insert the panel** in the Info `TabsContent`, between the standard details block and the album `Separator`:

Find:

```tsx
              <Row label="Hash" value={photo.hash ?? "—"} />
            </div>
            <Separator />
            {/* Keyed on photo.id so membership re-initializes per photo during
              arrow-key navigation. */}
            <AlbumMembership key={photo.id} photo={photo} />
```

Replace with:

```tsx
              <Row label="Hash" value={photo.hash ?? "—"} />
            </div>
            <FeatureGate feature={FeatureKey.Metadata}>
              <Separator />
              <MetadataPanel key={photo.id} photo={photo} />
            </FeatureGate>
            <Separator />
            {/* Keyed on photo.id so membership re-initializes per photo during
              arrow-key navigation. */}
            <AlbumMembership key={photo.id} photo={photo} />
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`

```bash
git add apps/web/src/features/lightbox/lightbox-sidebar.tsx
git commit -m "feat(metadata): mount MetadataPanel in the lightbox Info tab (feature-gated)"
```

---

### Task 5: Verification + browser smoke

- [ ] **Step 1: Suites + typecheck**

Run: `pnpm --filter @lumio/web test && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: web tests green; tsc clean (pre-existing only).

- [ ] **Step 2: Browser smoke** (the migration is already applied to the dev DB)

1. Enable the **Photo metadata** feature for a catalog (Settings → catalog → Features), or globally (Settings → Features).
2. Open a photo → **Info** tab. Expect the **Metadata** empty-state with **Film / Digital** buttons.
3. Click **Film** → the four NLP groups (Equipment / Shooting / Digitization / Development) appear with empty rows.
4. Type into **Film Stock** → after a couple of photos, focusing it again shows your prior values as autocomplete suggestions. Value persists across a reload (PUT worked).
5. On a digital photo with EXIF, apply **Digital** → standard rows show their EXIF values as placeholders; typing one overrides it.
6. Disable the feature → the Metadata section disappears (gate works); Source/dates/Hash + album membership remain.

- [ ] **Step 3: Report** any visual/UX issues for a follow-up polish pass.

---

## Self-review

- **Spec coverage:** gated API over the value store ✓; Info-tab custom display + inline edit + autocomplete ✓; apply-preset empty-state ✓; standard-field EXIF placeholder + override ✓; feature gate wraps the section ✓. Out of scope (1b-scale): schema-builder page (add/rename/reorder/toggle fields), save-as-preset, bulk-fill selection action, upload-time entry panel, per-catalog standard enable/disable UI.
- **Placeholders:** none — all route + component code is concrete. The one NOTE (confirm `FeatureGate` export/prop shape) is a verification step against an existing file.
- **Type consistency:** `ResolvedGroup`/`ResolvedField`/`FieldType`/`MetadataValueSource` (from 1b-core) are consumed identically by the routes and components. Routes call the 1b-core DB functions with their established signatures. `catalogApiUrl(slug, path)` and `useCatalog()` match their definitions.

## Next plan (1b-scale, not this one)

Schema-builder settings page (groups/fields CRUD + drag-reorder via `computeReorder`, toggle enabled/suggests, per-catalog standard enable/disable + override); save-as-preset (`MetadataPreset`); bulk-fill from a grid selection; upload-time entry panel. Then Phase 2 (search + smart albums over metadata, salvaging PR #68's engine).
