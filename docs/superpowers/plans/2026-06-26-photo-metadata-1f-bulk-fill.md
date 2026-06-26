> **⚠️ SUPERSEDED (2026-06-26)** by `2026-06-26-selection-inspector-panel.md`.
> Bulk-fill is delivered by the docked **selection inspector** (live per-field
> across the selection via the existing `/metadata/selection` route), not by the
> dialog + new `/metadata/bulk` route described below. Do not implement this plan.

# Photo Metadata 1f — Bulk-Fill a Roll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Select many photos on the grid → set custom metadata fields once → applied to all of them. The "tag the whole roll as Portra/Bronica in one go" workflow.

**Architecture:** A DI'd `bulkSetPhotoMetadataValues` in `@lumio/db`, a gated `POST …/metadata/bulk` route, and a self-gating `BulkMetadataButton` (with a `BulkMetadataDialog`) added to the shared `SelectionActions` toolbar. The dialog fetches the catalog schema, renders a form of the custom fields, and applies only the fields the user actually filled (blank = leave untouched). No DB migration.

**Tech Stack:** Prisma 6 (DI), Vitest fakes, Next.js routes, React client + shadcn Dialog/Select/Input/Button, `useCatalog`/`useFeature`.

---

## File structure
- Modify `packages/db/src/metadata.ts` (+ test) — `bulkSetPhotoMetadataValues`.
- Create `apps/web/src/app/api/c/[catalog]/metadata/bulk/route.ts` — POST.
- Create `apps/web/src/components/photo-actions/bulk-metadata-dialog.tsx` — the gated button + dialog.
- Modify `apps/web/src/components/photo-actions/selection-actions.tsx` — mount the button.

---

### Task 1: `bulkSetPhotoMetadataValues` + bulk route

**Files:** `packages/db/src/metadata.ts` (+ test); new route.

- [ ] **Step 1: Failing test** (append to `metadata.test.ts`; add to the import)

```ts
describe("bulkSetPhotoMetadataValues", () => {
  it("upserts each non-empty value for every photo (update-or-create)", async () => {
    const creates: any[] = [];
    let updates = 0;
    const db = {
      $transaction: async (fn: (tx: any) => Promise<unknown>) =>
        fn({
          photoMetadataValue: {
            updateMany: async () => { updates += 1; return { count: 0 }; },
            create: async ({ data }: any) => { creates.push(data); return data; },
          },
        }),
    } as never;
    await bulkSetPhotoMetadataValues(
      ["p1", "p2"],
      [{ fieldId: "f1", value: "Kodak Portra 400" }, { fieldId: "f2", value: "  " }],
      db,
    );
    // f2 is blank → skipped; f1 applied to p1 and p2
    expect(updates).toBe(2);
    expect(creates).toEqual([
      { photoId: "p1", fieldId: "f1", value: "Kodak Portra 400" },
      { photoId: "p2", fieldId: "f1", value: "Kodak Portra 400" },
    ]);
  });

  it("is a no-op when there are no photos or no non-empty values", async () => {
    let touched = false;
    const db = { $transaction: async () => { touched = true; } } as never;
    await bulkSetPhotoMetadataValues([], [{ fieldId: "f1", value: "x" }], db);
    await bulkSetPhotoMetadataValues(["p1"], [{ fieldId: "f1", value: "" }], db);
    expect(touched).toBe(false);
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @lumio/db test -- metadata`

- [ ] **Step 3: Implement** in `metadata.ts`

```ts
/** Set (non-empty) values on many photos at once. Blank values are skipped, so
 *  a bulk edit only touches the fields the caller actually filled. */
export async function bulkSetPhotoMetadataValues(
  photoIds: string[],
  values: { fieldId: string; value: string }[],
  db: TxDb = prisma,
): Promise<void> {
  const clean = values
    .map((v) => ({ fieldId: v.fieldId, value: v.value.trim() }))
    .filter((v) => v.value !== "");
  if (photoIds.length === 0 || clean.length === 0) return;
  await db.$transaction(async (tx) => {
    for (const photoId of photoIds) {
      for (const { fieldId, value } of clean) {
        const updated = await tx.photoMetadataValue.updateMany({
          where: { photoId, fieldId },
          data: { value },
        });
        if (updated.count === 0) {
          await tx.photoMetadataValue.create({ data: { photoId, fieldId, value } });
        }
      }
    }
  });
}
```

- [ ] **Step 4: Run → pass.** Then the route:

```ts
// apps/web/src/app/api/c/[catalog]/metadata/bulk/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { bulkSetPhotoMetadataValues, getCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as
    | { photoIds?: unknown; values?: unknown }
    | null;
  const photoIds = Array.isArray(body?.photoIds)
    ? body!.photoIds.filter((p): p is string => typeof p === "string")
    : [];
  const rawValues = Array.isArray(body?.values) ? body!.values : [];
  if (photoIds.length === 0) return NextResponse.json({ error: "no photos" }, { status: 400 });

  // Only accept values for fields that belong to this catalog.
  const schema = await getCatalogSchema(catalog.id);
  const known = new Set(schema.flatMap((g) => g.fields.map((f) => f.id)));
  const values = (rawValues as Array<{ fieldId?: unknown; value?: unknown }>)
    .filter((v) => typeof v.fieldId === "string" && known.has(v.fieldId) && typeof v.value === "string")
    .map((v) => ({ fieldId: v.fieldId as string, value: v.value as string }));

  await bulkSetPhotoMetadataValues(photoIds, values);
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 5:** Typecheck db + commit.

```bash
git add packages/db/src/metadata.ts packages/db/src/metadata.test.ts "apps/web/src/app/api/c/[catalog]/metadata/bulk/route.ts"
git commit -m "feat(metadata): bulk-set values across photos + bulk route"
```

---

### Task 2: `BulkMetadataDialog` + gated button

**Files:** Create `apps/web/src/components/photo-actions/bulk-metadata-dialog.tsx`.

Self-gating: renders nothing unless `useFeature(FeatureKey.Metadata)` is true. The button opens a dialog that fetches the schema lazily, renders a form of the custom fields, and applies the filled ones to the selection.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/components/photo-actions/bulk-metadata-dialog.tsx
"use client";

import { useEffect, useState } from "react";
import { Tags } from "lucide-react";
import { toast } from "sonner";
import { FeatureKey, FieldType, type MetadataSchema } from "@lumio/shared";
import { useFeature } from "@/components/features/features-provider";
import { useCatalog } from "@/components/providers/catalog-context";
import { catalogApiUrl } from "@/lib/catalog-api";
import { postJson } from "@/lib/http";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function BulkMetadataButton({
  selectedIds,
  disabled,
  onApplied,
}: {
  selectedIds: Set<string>;
  disabled?: boolean;
  onApplied: () => void;
}) {
  const enabled = useFeature(FeatureKey.Metadata);
  const [open, setOpen] = useState(false);
  if (!enabled) return null;
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon-sm" disabled={disabled} onClick={() => setOpen(true)} aria-label="Edit metadata">
            <Tags aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Edit metadata</TooltipContent>
      </Tooltip>
      {open && (
        <BulkMetadataDialog
          ids={[...selectedIds]}
          onClose={() => setOpen(false)}
          onApplied={() => { setOpen(false); onApplied(); }}
        />
      )}
    </>
  );
}

function BulkMetadataDialog({ ids, onClose, onApplied }: { ids: string[]; onClose: () => void; onApplied: () => void }) {
  const { slug } = useCatalog();
  const [schema, setSchema] = useState<MetadataSchema | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(catalogApiUrl(slug, "/metadata/schema"))
      .then((r) => (r.ok ? r.json() : { schema: [] }))
      .then((d: { schema: MetadataSchema }) => alive && setSchema(d.schema))
      .catch(() => alive && setSchema([]));
    return () => { alive = false; };
  }, [slug]);

  const fields = (schema ?? []).flatMap((g) => g.fields);
  const filled = Object.entries(values).filter(([, v]) => v.trim() !== "");

  async function apply() {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/bulk"), {
        photoIds: ids,
        values: filled.map(([fieldId, value]) => ({ fieldId, value })),
      });
      toast.success(`Updated ${ids.length} photo${ids.length === 1 ? "" : "s"}`);
      onApplied();
    } catch {
      toast.error("Couldn't update metadata.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit metadata · {ids.length} photo{ids.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Only the fields you fill are applied; the rest stay untouched.</DialogDescription>
        </DialogHeader>

        {schema === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : fields.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No custom fields. Add some in Settings → Metadata.
          </p>
        ) : (
          <div className="space-y-4">
            {(schema ?? []).filter((g) => g.fields.length > 0).map((group) => (
              <div key={group.id} className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
                {group.fields.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-3">
                    <span className="shrink-0 text-sm text-muted-foreground">{f.label}</span>
                    <BulkInput
                      field={f}
                      value={values[f.id] ?? ""}
                      onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void apply()} disabled={busy || filled.length === 0}>
            Apply to {ids.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkInput({
  field,
  value,
  onChange,
}: {
  field: MetadataSchema[number]["fields"][number];
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.type === FieldType.Choice && field.options.length > 0) {
    return (
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-44"><SelectValue placeholder="—" /></SelectTrigger>
        <SelectContent>
          {field.options.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
        </SelectContent>
      </Select>
    );
  }
  if (field.type === FieldType.Textarea) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="w-44 resize-none rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
      />
    );
  }
  return (
    <Input
      type={field.type === FieldType.Number ? "number" : field.type === FieldType.Date ? "date" : "text"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 w-44"
    />
  );
}
```

- [ ] **Step 2:** Typecheck web + commit.

```bash
git add apps/web/src/components/photo-actions/bulk-metadata-dialog.tsx
git commit -m "feat(metadata): bulk metadata edit dialog (gated)"
```

---

### Task 3: Mount the button in `SelectionActions`

**Files:** `apps/web/src/components/photo-actions/selection-actions.tsx`.

- [ ] **Step 1:** Import + render. Add `import { BulkMetadataButton } from "@/components/photo-actions/bulk-metadata-dialog";`. Place it just before the trash `Tooltip` (after the `DownloadMenu`):

```tsx
      <BulkMetadataButton selectedIds={selectedIds} disabled={none} onApplied={clearSelection} />
```

- [ ] **Step 2:** Typecheck web + commit.

```bash
git add apps/web/src/components/photo-actions/selection-actions.tsx
git commit -m "feat(metadata): add bulk metadata action to the selection toolbar"
```

---

### Task 4: Verify
- [ ] `pnpm --filter @lumio/db test -- metadata` (green), `pnpm --filter @lumio/db exec tsc --noEmit` (clean), `pnpm --filter @lumio/web exec tsc --noEmit` (clean).
- [ ] **Browser smoke** (controller): on a catalog with custom fields, select several photos → "Edit metadata" appears in the toolbar (only when the feature's on) → fill Film Stock + Camera → Apply → open each photo's Info tab and confirm both got the values; a blank field left others untouched. With the feature off, the action is absent.

---

## Self-review
- **Spec coverage:** grid multi-select → set fields once across all selected ✓ (the "roll" workflow); gated + only-filled-fields-applied ✓.
- **Placeholders:** none.
- **Type consistency:** `bulkSetPhotoMetadataValues(photoIds, values, db)` matches Task 1; the route validates fieldIds against `getCatalogSchema`; `BulkMetadataButton` uses `useFeature`/`useCatalog`/`postJson`/`catalogApiUrl`; `MetadataSchema` field shape (incl. `options`) drives `BulkInput`.

## Next (later): drag-reorder fields/groups; save-as-preset; upload-time entry; Phase 2 search + smart albums.
