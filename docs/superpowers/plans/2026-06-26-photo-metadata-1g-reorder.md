# Photo Metadata 1g — Reorder Fields & Groups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`).

**Goal:** Reorder fields within a group and reorder groups, via up/down controls in the builder. No DB migration — reuses the fractional-index `position` columns (`COLLATE "C"`) + `computeReorder`.

**Architecture:** DI'd `reorderMetadataField`/`reorderMetadataGroup` in `@lumio/db` (load the ordered siblings → `computeReorder(items, movedId, afterId)` → persist the position updates in a transaction). One gated `POST …/metadata/reorder` route. In the builder, each field row and each group header get up/down buttons (disabled at the ends); the client sends `{ kind, movedId, afterId }`.

**Tech Stack:** Prisma 6 (DI), `@lumio/shared` `computeReorder`/`OrderedItem`, Vitest fakes, Next.js route, React + lucide chevrons.

---

## File structure
- Modify `packages/db/src/metadata.ts` (+ test) — `reorderMetadataField`, `reorderMetadataGroup`.
- Create `apps/web/src/app/api/c/[catalog]/metadata/reorder/route.ts` — POST.
- Modify `apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx` — up/down controls + handlers.

---

### Task 1: Reorder DB functions

**Files:** `packages/db/src/metadata.ts` (+ test).

- [ ] **Step 1: Failing tests** (append to `metadata.test.ts`; add the two fns to the import; `computeReorder` lives in `@lumio/shared` and is already trustworthy — these tests just confirm wiring)

```ts
describe("reorderMetadataField", () => {
  it("loads the group's ordered fields and persists position updates", async () => {
    const updated: Array<{ id: string; position: string }> = [];
    const db = {
      metadataField: {
        findMany: async () => [
          { id: "a", position: "a0" },
          { id: "b", position: "a1" },
          { id: "c", position: "a2" },
        ],
        update: async ({ where, data }: any) => { updated.push({ id: where.id, position: data.position }); return {}; },
      },
      $transaction: async (fn: (tx: any) => Promise<unknown>) =>
        fn({ metadataField: { update: async (a: any) => { updated.push({ id: a.where.id, position: a.data.position }); return {}; } } }),
    } as never;
    // move "c" to the front (afterId null)
    await reorderMetadataField("g1", "c", null, db);
    expect(updated.some((u) => u.id === "c")).toBe(true); // the moved row got a new key
  });
});

describe("reorderMetadataGroup", () => {
  it("reorders groups within a catalog", async () => {
    const updated: string[] = [];
    const db = {
      metadataGroup: { findMany: async () => [{ id: "g1", position: "a0" }, { id: "g2", position: "a1" }] },
      $transaction: async (fn: (tx: any) => Promise<unknown>) =>
        fn({ metadataGroup: { update: async (a: any) => { updated.push(a.where.id); return {}; } } }),
    } as never;
    await reorderMetadataGroup("cat1", "g2", null, db); // g2 to front
    expect(updated).toContain("g2");
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @lumio/db test -- metadata`

- [ ] **Step 3: Implement** in `metadata.ts` (import `computeReorder`, `type OrderedItem` from `@lumio/shared` — add to the existing import)

```ts
export async function reorderMetadataField(
  groupId: string,
  movedId: string,
  afterId: string | null,
  db: FieldDb & TxDb = prisma,
): Promise<void> {
  const rows = await db.metadataField.findMany({ where: { groupId }, orderBy: { position: "asc" } });
  const items: OrderedItem[] = rows.map((r) => ({ id: r.id, position: r.position }));
  const updates = computeReorder(items, movedId, afterId);
  if (updates.length === 0) return;
  await db.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.metadataField.update({ where: { id: u.id }, data: { position: u.position } });
    }
  });
}

export async function reorderMetadataGroup(
  catalogId: string,
  movedId: string,
  afterId: string | null,
  db: GroupDb & TxDb = prisma,
): Promise<void> {
  const rows = await db.metadataGroup.findMany({ where: { catalogId }, orderBy: { position: "asc" } });
  const items: OrderedItem[] = rows.map((r) => ({ id: r.id, position: r.position }));
  const updates = computeReorder(items, movedId, afterId);
  if (updates.length === 0) return;
  await db.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.metadataGroup.update({ where: { id: u.id }, data: { position: u.position } });
    }
  });
}
```

- [ ] **Step 4: Run → pass.** Typecheck db + commit.

```bash
git add packages/db/src/metadata.ts packages/db/src/metadata.test.ts
git commit -m "feat(metadata): reorder fields & groups (computeReorder)"
```

---

### Task 2: Reorder route

**Files:** Create `apps/web/src/app/api/c/[catalog]/metadata/reorder/route.ts`.

```ts
// apps/web/src/app/api/c/[catalog]/metadata/reorder/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import {
  getCatalogSchema,
  isFeatureEnabled,
  reorderMetadataField,
  reorderMetadataGroup,
} from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata)))
    return NextResponse.json({ error: "disabled" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as
    | { kind?: string; movedId?: string; afterId?: string | null }
    | null;
  if (!body?.movedId || (body.kind !== "field" && body.kind !== "group")) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  const afterId = typeof body.afterId === "string" ? body.afterId : null;
  const schema = await getCatalogSchema(catalog.id);

  if (body.kind === "group") {
    if (!schema.some((g) => g.id === body.movedId)) return NextResponse.json({ error: "unknown" }, { status: 404 });
    await reorderMetadataGroup(catalog.id, body.movedId, afterId);
    return NextResponse.json({ ok: true });
  }

  // field: find its group (and confirm ownership)
  const group = schema.find((g) => g.fields.some((f) => f.id === body.movedId));
  if (!group) return NextResponse.json({ error: "unknown" }, { status: 404 });
  await reorderMetadataField(group.id, body.movedId, afterId);
  return NextResponse.json({ ok: true });
});
```

- [ ] Typecheck web + commit.

```bash
git add "apps/web/src/app/api/c/[catalog]/metadata/reorder/route.ts"
git commit -m "feat(metadata): reorder route"
```

---

### Task 3: Up/down controls in the builder

**Files:** `apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx`.

- [ ] **Step 1: Imports** — add `ChevronUp, ChevronDown` to the lucide import.

- [ ] **Step 2: Handler.** Add inside the component (uses `refresh` from the cache-invalidation helper):

```tsx
async function reorder(kind: "field" | "group", movedId: string, afterId: string | null) {
  setBusy(true);
  try {
    await postJson(catalogApiUrl(slug, "/metadata/reorder"), { kind, movedId, afterId });
    refresh();
  } finally {
    setBusy(false);
  }
}
```

- [ ] **Step 3: Group up/down.** In the group `.map((group, gi) => …)` (add the index), put move controls next to the group label:

```tsx
<div className="flex items-center gap-1">
  <p className="flex-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
  <Button variant="ghost" size="icon-sm" aria-label="Move group up" disabled={busy || gi === 0}
    onClick={() => void reorder("group", group.id, gi >= 2 ? schema[gi - 2]!.id : null)}>
    <ChevronUp aria-hidden />
  </Button>
  <Button variant="ghost" size="icon-sm" aria-label="Move group down" disabled={busy || gi === schema.length - 1}
    onClick={() => void reorder("group", group.id, schema[gi + 1]!.id)}>
    <ChevronDown aria-hidden />
  </Button>
</div>
```

- [ ] **Step 4: Field up/down.** In each field row's `.map((f, fi) => …)` (add the index), add two ghost chevron buttons before the delete button. "Up" places the field after the one two slots above (or front); "down" places it after the next:

```tsx
<Button variant="ghost" size="icon-sm" aria-label={`Move ${f.label} up`} disabled={busy || fi === 0}
  onClick={() => void reorder("field", f.id, fi >= 2 ? group.fields[fi - 2]!.id : null)}>
  <ChevronUp aria-hidden />
</Button>
<Button variant="ghost" size="icon-sm" aria-label={`Move ${f.label} down`} disabled={busy || fi === group.fields.length - 1}
  onClick={() => void reorder("field", f.id, group.fields[fi + 1]!.id)}>
  <ChevronDown aria-hidden />
</Button>
```

NOTE: `afterId` semantics match `computeReorder` — "move up" = sit immediately after the row two positions above (so it lands directly above its old predecessor), `null` = move to the front. "Move down" = sit after the next row.

- [ ] **Step 5:** Typecheck web + commit.

```bash
git add "apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx"
git commit -m "feat(metadata): up/down reorder controls in the builder"
```

---

### Task 4: Verify
- [ ] `pnpm --filter @lumio/db test -- metadata` (green), `pnpm --filter @lumio/db exec tsc --noEmit` (clean), `pnpm --filter @lumio/web exec tsc --noEmit` (clean).
- [ ] **Browser smoke** (controller): in the builder, move a field up/down within its group (order persists on refresh); move a group up/down; ends are disabled; the Info-tab order reflects the new arrangement.

## Self-review
- **Spec coverage:** reorder fields within a group + reorder groups ✓. Cross-group field moves deferred (a field moves only within its group). Uses `computeReorder` + `COLLATE "C"` positions — no migration.
- **Type consistency:** `reorderMetadataField(groupId, movedId, afterId, db)` / `reorderMetadataGroup(catalogId, movedId, afterId, db)` match Task 1; the route derives the field's group from `getCatalogSchema`; the client passes `{ kind, movedId, afterId }`.

## Next (later): save-as-preset (needs a `MetadataPreset` table + migration); cross-group field moves; upload-time entry; Phase 2 search + smart albums.
