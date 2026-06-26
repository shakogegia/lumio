# Photo Metadata 1d — Field Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the per-catalog Custom-fields list on Settings → Metadata editable: add a group, add a field to a group, rename a field, change its type, toggle its enabled/suggests flags, and delete a field. Builds on the apply-preset/clear already there.

**Architecture:** New dependency-injected CRUD functions in `@lumio/db/metadata.ts` (positions via `keysBetween`, keys auto-slugged & de-duped), thin catalog-scoped gated API routes, and an editable rewrite of the "Custom fields" card in `metadata-config-form.tsx`. Reorder (drag), save-as-preset, bulk-fill, and upload-entry are explicitly out of scope (later).

**Tech Stack:** TS ESM, Prisma 6, Vitest (DI fakes), Next.js route handlers, React client components, existing `Switch`/`Button`/`Card`/`Input`/`Select` UI + `postJson`/`apiPaths`/`catalogApiUrl`.

---

## File structure
- Modify `packages/db/src/metadata.ts` (+ test) — `createMetadataGroup`, `createMetadataField`, `updateMetadataField`, `deleteMetadataField`, and a `slugify` helper.
- Create `apps/web/src/app/api/c/[catalog]/metadata/groups/route.ts` — POST.
- Create `apps/web/src/app/api/c/[catalog]/metadata/fields/route.ts` — POST.
- Create `apps/web/src/app/api/c/[catalog]/metadata/fields/[fieldId]/route.ts` — PATCH, DELETE.
- Modify `apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx` — editable builder.

---

### Task 1: DB CRUD functions (DI)

**Files:** Modify `packages/db/src/metadata.ts` + `packages/db/src/metadata.test.ts`.

- [ ] **Step 1: Failing tests** (append to `metadata.test.ts`; add the four functions to the top import)

```ts
describe("createMetadataField", () => {
  it("creates a custom field at the end of its group with a unique slug key", async () => {
    const created: any[] = [];
    const db = {
      metadataField: {
        findMany: async ({ select }: any) =>
          select?.key
            ? [{ key: "film-stock" }, { key: "developer" }]
            : [{ position: "a0" }, { position: "a1" }],
        create: async ({ data }: any) => { created.push(data); return { id: "f9", ...data }; },
      },
    } as never;
    const row = await createMetadataField("cat1", "g1", "Film Stock", "text", db);
    expect(row.key).toBe("film-stock-2"); // collides with existing "film-stock"
    expect(created[0]).toMatchObject({ catalogId: "cat1", groupId: "g1", kind: "custom", label: "Film Stock", type: "text" });
    expect(created[0].position > "a1").toBe(true); // appended after last
  });
});

describe("createMetadataGroup", () => {
  it("creates a group appended after the last position", async () => {
    let made: any = null;
    const db = {
      metadataGroup: {
        findMany: async () => [{ position: "a0" }],
        create: async ({ data }: any) => { made = data; return { id: "g9", ...data }; },
      },
    } as never;
    await createMetadataGroup("cat1", "Process", db);
    expect(made).toMatchObject({ catalogId: "cat1", label: "Process" });
    expect(made.position > "a0").toBe(true);
  });
});

describe("updateMetadataField / deleteMetadataField", () => {
  it("updates only the given fields", async () => {
    let arg: any = null;
    const db = { metadataField: { update: async (a: any) => { arg = a; return {}; } } } as never;
    await updateMetadataField("f1", { label: "Stock", enabled: false }, db);
    expect(arg).toEqual({ where: { id: "f1" }, data: { label: "Stock", enabled: false } });
  });
  it("deletes by id", async () => {
    let arg: any = null;
    const db = { metadataField: { delete: async (a: any) => { arg = a; return {}; } } } as never;
    await deleteMetadataField("f1", db);
    expect(arg).toEqual({ where: { id: "f1" } });
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @lumio/db test -- metadata`

- [ ] **Step 3: Implement** in `metadata.ts`

```ts
/** label → stable url-ish slug; empty falls back to "field". */
export function slugify(label: string): string {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "field";
}

export async function createMetadataGroup(
  catalogId: string,
  label: string,
  db: GroupDb = prisma,
): Promise<{ id: string }> {
  const groups = await db.metadataGroup.findMany({ where: { catalogId }, orderBy: { position: "asc" } });
  const last = groups.at(-1)?.position ?? null;
  const position = keysBetween(last, null, 1)[0]!;
  return db.metadataGroup.create({ data: { catalogId, label, position } });
}

export async function createMetadataField(
  catalogId: string,
  groupId: string,
  label: string,
  type: string,
  db: FieldDb = prisma,
): Promise<{ id: string; key: string }> {
  const [inGroup, taken] = await Promise.all([
    db.metadataField.findMany({ where: { catalogId, groupId }, orderBy: { position: "asc" } }),
    db.metadataField.findMany({ where: { catalogId }, select: { key: true } }),
  ]);
  const used = new Set(taken.map((f) => f.key));
  const base = slugify(label);
  let key = base;
  for (let i = 2; used.has(key); i += 1) key = `${base}-${i}`;
  const last = inGroup.at(-1)?.position ?? null;
  const position = keysBetween(last, null, 1)[0]!;
  return db.metadataField.create({
    data: { catalogId, groupId, key, label, type, kind: "custom", position },
  });
}

export async function updateMetadataField(
  fieldId: string,
  data: { label?: string; type?: string; enabled?: boolean; suggests?: boolean },
  db: FieldDb = prisma,
): Promise<void> {
  await db.metadataField.update({ where: { id: fieldId }, data });
}

export async function deleteMetadataField(fieldId: string, db: FieldDb = prisma): Promise<void> {
  await db.metadataField.delete({ where: { id: fieldId } });
}
```

NOTE: `GroupDb`/`FieldDb` are the `Pick<PrismaClient, …>` aliases already defined at the top of `metadata.ts`. `keysBetween` is already imported there. If `GroupDb`/`FieldDb` don't include `create`/`update`/`delete`, widen those `Pick` aliases to include them (they currently cover `findMany`; add the methods used here).

- [ ] **Step 4: Run → pass.** Typecheck db + commit.

```bash
git add packages/db/src/metadata.ts packages/db/src/metadata.test.ts
git commit -m "feat(metadata): field/group CRUD db functions (slug keys, appended positions)"
```

---

### Task 2: API routes

**Files:** the three route files.

- [ ] **Step 1: `groups/route.ts`**

```ts
// apps/web/src/app/api/c/[catalog]/metadata/groups/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { createMetadataGroup, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { label?: string } | null;
  const label = body?.label?.trim();
  if (!label) return NextResponse.json({ error: "label required" }, { status: 400 });
  const group = await createMetadataGroup(catalog.id, label);
  return NextResponse.json({ id: group.id }, { status: 201 });
});
```

- [ ] **Step 2: `fields/route.ts`** (validate the group belongs to the catalog)

```ts
// apps/web/src/app/api/c/[catalog]/metadata/fields/route.ts
import { NextResponse } from "next/server";
import { FeatureKey, FieldType } from "@lumio/shared";
import { createMetadataField, getCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = new Set<string>(Object.values(FieldType));

export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as
    | { groupId?: string; label?: string; type?: string }
    | null;
  const label = body?.label?.trim();
  const type = body?.type ?? FieldType.Text;
  if (!body?.groupId || !label) return NextResponse.json({ error: "groupId and label required" }, { status: 400 });
  if (!TYPES.has(type)) return NextResponse.json({ error: "bad type" }, { status: 400 });
  const schema = await getCatalogSchema(catalog.id);
  if (!schema.some((g) => g.id === body.groupId))
    return NextResponse.json({ error: "unknown group" }, { status: 400 });
  const field = await createMetadataField(catalog.id, body.groupId, label, type);
  return NextResponse.json({ id: field.id }, { status: 201 });
});
```

- [ ] **Step 3: `fields/[fieldId]/route.ts`** (PATCH + DELETE, ownership-checked)

```ts
// apps/web/src/app/api/c/[catalog]/metadata/fields/[fieldId]/route.ts
import { NextResponse } from "next/server";
import { FeatureKey, FieldType } from "@lumio/shared";
import {
  deleteMetadataField,
  getCatalogSchema,
  isFeatureEnabled,
  updateMetadataField,
} from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = new Set<string>(Object.values(FieldType));

async function ownsField(catalogId: string, fieldId: string): Promise<boolean> {
  const schema = await getCatalogSchema(catalogId);
  return schema.some((g) => g.fields.some((f) => f.id === fieldId));
}

export const PATCH = withCatalog<{ fieldId: string }>(async (request, context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const { fieldId } = await context.params;
  if (!(await ownsField(catalog.id, fieldId)))
    return NextResponse.json({ error: "unknown field" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as
    | { label?: string; type?: string; enabled?: boolean; suggests?: boolean }
    | null;
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 });
  if (body.type !== undefined && !TYPES.has(body.type))
    return NextResponse.json({ error: "bad type" }, { status: 400 });
  const data: { label?: string; type?: string; enabled?: boolean; suggests?: boolean } = {};
  if (typeof body.label === "string" && body.label.trim()) data.label = body.label.trim();
  if (body.type !== undefined) data.type = body.type;
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (typeof body.suggests === "boolean") data.suggests = body.suggests;
  await updateMetadataField(fieldId, data);
  return NextResponse.json({ ok: true });
});

export const DELETE = withCatalog<{ fieldId: string }>(async (_request, context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const { fieldId } = await context.params;
  if (!(await ownsField(catalog.id, fieldId)))
    return NextResponse.json({ error: "unknown field" }, { status: 404 });
  await deleteMetadataField(fieldId);
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 4: Typecheck web + commit**

```bash
git add "apps/web/src/app/api/c/[catalog]/metadata/groups" "apps/web/src/app/api/c/[catalog]/metadata/fields"
git commit -m "feat(metadata): field/group CRUD API routes"
```

---

### Task 3: Editable builder in the config form

**Files:** Modify `apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx`.

Replace the read-only field-chip list (inside the `Custom fields` card, the `hasFields` branch) with an editable builder. Keep the empty-state "Apply Negative Lab Pro preset" button and the "Clear all fields" button.

- [ ] **Step 1: Add imports** at the top of the file

```tsx
import { FieldType } from "@lumio/shared";
import { Input } from "@/components/ui/input";
import { Trash2, Plus } from "lucide-react";
```

- [ ] **Step 2: Replace the `hasFields ? (…)` block's field list** with grouped editable rows + add-field + add-group controls. Use this builder markup (calls go to the new routes; `router.refresh()` after each):

```tsx
{schema
  .filter((g) => true)
  .map((group) => (
    <div key={group.id} className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {group.label}
      </p>
      <div className="space-y-1.5">
        {group.fields.map((f) => (
          <div key={f.id} className="flex items-center gap-2">
            <Input
              defaultValue={f.label}
              onBlur={(e) => {
                const label = e.target.value.trim();
                if (label && label !== f.label) void patchField(f.id, { label });
              }}
              className="h-8 flex-1"
            />
            <select
              defaultValue={f.type}
              onChange={(e) => void patchField(f.id, { type: e.target.value })}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs"
            >
              {Object.values(FieldType).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <Switch
                checked={f.enabled}
                onCheckedChange={(v) => void patchField(f.id, { enabled: v })}
              />
              on
            </label>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Delete ${f.label}`}
              disabled={busy}
              onClick={() => void deleteField(f.id)}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
        <AddField groupId={group.id} onAdd={addField} busy={busy} />
      </div>
    </div>
  ))}
<Button variant="outline" size="sm" disabled={busy} onClick={() => void addGroup()}>
  <Plus aria-hidden /> Add group
</Button>
```

- [ ] **Step 3: Add the handlers + `AddField` subcomponent** inside the file. The handlers POST/PATCH/DELETE the new routes and `router.refresh()`:

```tsx
async function patchField(fieldId: string, data: Record<string, unknown>) {
  await postJson(catalogApiUrl(slug, `/metadata/fields/${fieldId}`), data, "PATCH");
  router.refresh();
}
async function deleteField(fieldId: string) {
  setBusy(true);
  try {
    await postJson(catalogApiUrl(slug, `/metadata/fields/${fieldId}`), {}, "DELETE");
    router.refresh();
  } finally { setBusy(false); }
}
async function addField(groupId: string, label: string, type: string) {
  await postJson(catalogApiUrl(slug, "/metadata/fields"), { groupId, label, type });
  router.refresh();
}
async function addGroup() {
  const label = window.prompt("New group name")?.trim();
  if (!label) return;
  setBusy(true);
  try {
    await postJson(catalogApiUrl(slug, "/metadata/groups"), { label });
    router.refresh();
  } finally { setBusy(false); }
}
```

```tsx
function AddField({
  groupId,
  onAdd,
  busy,
}: {
  groupId: string;
  onAdd: (groupId: string, label: string, type: string) => Promise<void>;
  busy: boolean;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<string>(FieldType.Text);
  return (
    <div className="flex items-center gap-2 pt-1">
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Add field…"
        className="h-8 flex-1"
        onKeyDown={(e) => {
          if (e.key === "Enter" && label.trim()) {
            void onAdd(groupId, label.trim(), type).then(() => setLabel(""));
          }
        }}
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="h-8 rounded-md border border-border bg-background px-2 text-xs"
      >
        {Object.values(FieldType).map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !label.trim()}
        onClick={() => void onAdd(groupId, label.trim(), type).then(() => setLabel(""))}
      >
        Add
      </Button>
    </div>
  );
}
```

NOTE: `window.prompt` for the new-group name is a deliberate v1 shortcut (a dialog can come later). `patchField` uses the existing `postJson(url, body, method)` with `"PATCH"`/`"DELETE"`. If `Input`'s import path or `Switch`'s `onCheckedChange` differs, match the real components (see `metadata-config-form.tsx`'s existing `Switch` usage). The `size="icon-sm"` button variant is used elsewhere (see `catalogs-list.tsx`).

- [ ] **Step 4: Typecheck web + commit**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`

```bash
git add "apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx"
git commit -m "feat(metadata): editable field builder (add/rename/retype/toggle/delete + add group)"
```

---

### Task 4: Verify

- [ ] **Step 1:** `pnpm --filter @lumio/db test -- metadata` (green) + `pnpm --filter @lumio/db exec tsc --noEmit` + `pnpm --filter @lumio/web exec tsc --noEmit` (clean).
- [ ] **Step 2: Browser smoke** (controller): on a catalog with custom on + NLP applied → rename a field (blur) → it persists; change a type; toggle a field off → it disappears from the Info tab; delete a field; add a field to a group → it appears in the Info tab; add a group.

---

## Self-review
- **Spec coverage:** add/rename/retype/enabled-toggle/delete fields + add group ✓. **Deferred:** suggests-toggle UI (the db `updateMetadataField` supports `suggests`, but the row UI only surfaces `enabled` — add a suggests control in a follow-up if wanted), group rename/delete, drag-reorder, save-as-preset, bulk-fill, upload-entry.
- **Placeholders:** none (the `window.prompt` group-name is an intentional v1 affordance, noted).
- **Type consistency:** `createMetadataField(catalogId, groupId, label, type, db)` etc. match Task 1; routes call them with those args; `FieldType` enum drives both the select options and route validation; `postJson(url, body, method)` matches.

## Next (later)
suggests-toggle in the row; group rename/delete; drag-reorder (`computeReorder`); save-as-preset (`MetadataPreset`); bulk-fill from grid selection; upload-time entry panel; then Phase 2 search.
