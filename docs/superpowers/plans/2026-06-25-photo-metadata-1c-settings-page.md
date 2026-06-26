# Photo Metadata 1c — Settings → Metadata Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the Settings → Metadata config surface: a sidebar entry (shown when the `Photo metadata` feature is globally on) → catalog list → per-catalog page with Standard/Custom toggles and **Apply Negative Lab Pro / Clear** + the current field list. This is the entry point that makes the whole feature reachable.

**Architecture:** Server pages under `settings/metadata` reuse `listCatalogs`, `getCatalogFeatureStates`, `getCatalogSchema`. A client `MetadataConfigForm` toggles the two per-catalog feature flags via the existing `/api/features` endpoint and applies/clears the schema via the catalog-scoped metadata routes. New backend: `clearCatalogSchema` + a `clear` route. The full per-field add/rename/reorder/delete builder is a SEPARATE later plan (1d) — this plan ships preset-apply + clear + read-only field list.

**Tech Stack:** Next.js 16 server + client components, `@lumio/db`, `@lumio/shared` (`FeatureKey`, `getPreset`), existing `Switch`/`Field`/`postJson`/`apiPaths` infra.

---

## File structure

- Modify `packages/db/src/metadata.ts` (+ test) — `clearCatalogSchema`.
- Create `apps/web/src/app/api/c/[catalog]/metadata/clear/route.ts`.
- Modify `apps/web/src/components/settings-sidebar.tsx` — conditional "Metadata" entry.
- Modify `apps/web/src/app/(app)/settings/layout.tsx` — compute `showMetadata`, pass it.
- Create `apps/web/src/app/(app)/settings/metadata/page.tsx` — catalog list.
- Create `apps/web/src/app/(app)/settings/metadata/[id]/page.tsx` — per-catalog config (server).
- Create `apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx` — client form.

---

### Task 1: `clearCatalogSchema` + clear route

**Files:** Modify `packages/db/src/metadata.ts` + `packages/db/src/metadata.test.ts`; create the clear route.

- [ ] **Step 1: Failing test** (append to `metadata.test.ts`)

```ts
describe("clearCatalogSchema", () => {
  it("deletes a catalog's fields then groups inside a transaction", async () => {
    const order: string[] = [];
    const db = {
      $transaction: async (fn: (tx: any) => Promise<unknown>) =>
        fn({
          metadataField: { deleteMany: async () => { order.push("fields"); return { count: 3 }; } },
          metadataGroup: { deleteMany: async () => { order.push("groups"); return { count: 2 }; } },
        }),
    } as never;
    await clearCatalogSchema("cat1", db);
    expect(order).toEqual(["fields", "groups"]);
  });
});
```

Add `clearCatalogSchema` to the import in the test's top `import { ... } from "./metadata.js";`.

- [ ] **Step 2: Run → fail** — `pnpm --filter @lumio/db test -- metadata` (clearCatalogSchema undefined).

- [ ] **Step 3: Implement** in `metadata.ts` (after `applyMetadataPreset`)

```ts
/** Remove a catalog's entire custom-field schema (fields first, then groups). */
export async function clearCatalogSchema(catalogId: string, db: TxDb = prisma): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.metadataField.deleteMany({ where: { catalogId } });
    await tx.metadataGroup.deleteMany({ where: { catalogId } });
  });
}
```

- [ ] **Step 4: Run → pass.** Then create the route:

```ts
// apps/web/src/app/api/c/[catalog]/metadata/clear/route.ts
import { NextResponse } from "next/server";
import { FeatureKey } from "@lumio/shared";
import { clearCatalogSchema, isFeatureEnabled } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (_request, _context, { catalog }) => {
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
    return NextResponse.json({ error: "Metadata feature disabled" }, { status: 404 });
  }
  await clearCatalogSchema(catalog.id);
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 5: Re-export already covers it** (`export * from "./metadata.js"`). Typecheck db + commit.

Run: `pnpm --filter @lumio/db exec tsc --noEmit` (clean).

```bash
git add packages/db/src/metadata.ts packages/db/src/metadata.test.ts "apps/web/src/app/api/c/[catalog]/metadata/clear/route.ts"
git commit -m "feat(metadata): clearCatalogSchema + clear route"
```

---

### Task 2: Conditional "Metadata" entry in the settings sidebar

**Files:** Modify `apps/web/src/components/settings-sidebar.tsx` and `apps/web/src/app/(app)/settings/layout.tsx`.

- [ ] **Step 1: Add a `showMetadata` prop + conditional item** in `settings-sidebar.tsx`

- Add `Tags` to the lucide import.
- Change the signature to accept `showMetadata: boolean`.
- Build the items list inside the component so the Metadata entry is conditional, inserted after Features:

```tsx
export function SettingsSidebar({
  backHref,
  catalogSlug,
  showMetadata,
}: {
  backHref: string;
  catalogSlug: string | null;
  showMetadata: boolean;
}) {
  const pathname = usePathname() ?? "/";
  const items: NavItem[] = [
    { href: "/settings/account", label: "Account", icon: User, match: ["/settings/account"] },
    { href: "/settings/catalogs", label: "Catalogs", icon: GalleryHorizontalEnd, match: ["/settings/catalogs"] },
    { href: "/settings/features", label: "Features", icon: ToggleRight, match: ["/settings/features"] },
    ...(showMetadata
      ? [{ href: "/settings/metadata", label: "Metadata", icon: Tags, match: ["/settings/metadata"] } as NavItem]
      : []),
    { href: "/settings/logs", label: "Logs", icon: FileClock, match: ["/settings/logs"] },
    { href: "/settings/users", label: "Users", icon: Users, match: ["/settings/users"] },
  ];
  // …render `items` instead of the old module-level ITEMS…
}
```

Delete the module-level `ITEMS` const (now built inside the component).

- [ ] **Step 2: Compute and pass `showMetadata`** in `settings/layout.tsx`

```tsx
import { getGlobalFeatureStates } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
// …
  const slug = await getDefaultCatalogSlug();
  const backHref = slug ? catalogPath(slug, "/photos") : "/";
  const features = await getGlobalFeatureStates();
  const showMetadata = features.find((f) => f.key === FeatureKey.Metadata)?.enabled ?? false;
  return (
    <>
      <SettingsSidebar backHref={backHref} catalogSlug={slug} showMetadata={showMetadata} />
      <div className="min-h-dvh pl-[76px]">{children}</div>
    </>
  );
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`

```bash
git add apps/web/src/components/settings-sidebar.tsx "apps/web/src/app/(app)/settings/layout.tsx"
git commit -m "feat(metadata): conditional Metadata entry in settings sidebar"
```

---

### Task 3: `settings/metadata` — catalog list

**Files:** Create `apps/web/src/app/(app)/settings/metadata/page.tsx`

- [ ] **Step 1: Write the page** (server; guards on the global feature)

```tsx
// apps/web/src/app/(app)/settings/metadata/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { FeatureKey } from "@lumio/shared";
import { getGlobalFeatureStates, listCatalogs } from "@lumio/db";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Metadata" };

export default async function MetadataSettingsPage() {
  const features = await getGlobalFeatureStates();
  if (!(features.find((f) => f.key === FeatureKey.Metadata)?.enabled ?? false)) notFound();
  const catalogs = await listCatalogs();

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Metadata</h1>
        <p className="text-sm text-muted-foreground">
          Configure standard and custom photo metadata per catalog.
        </p>
      </div>
      <Card>
        <CardContent className="divide-y p-0">
          {catalogs.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No catalogs yet.</p>
          ) : (
            catalogs.map((c) => (
              <Link
                key={c.id}
                href={`/settings/metadata/${c.id}`}
                className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-muted"
              >
                <span className="font-medium">{c.name}</span>
                <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
git add "apps/web/src/app/(app)/settings/metadata/page.tsx"
git commit -m "feat(metadata): settings/metadata catalog list page"
```

---

### Task 4: `settings/metadata/[id]` — per-catalog config + client form

**Files:** Create `…/settings/metadata/[id]/page.tsx` and `…/settings/metadata/[id]/metadata-config-form.tsx`.

- [ ] **Step 1: Server page**

```tsx
// apps/web/src/app/(app)/settings/metadata/[id]/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { FeatureKey } from "@lumio/shared";
import { getCatalogById, getCatalogFeatureStates, getCatalogSchema } from "@lumio/db";
import { MetadataConfigForm } from "./metadata-config-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catalog metadata" };

export default async function CatalogMetadataPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const catalog = await getCatalogById(id);
  if (!catalog) notFound();

  const featureStates = await getCatalogFeatureStates(catalog.id);
  const standard = featureStates.find((f) => f.key === FeatureKey.StandardMetadata);
  const custom = featureStates.find((f) => f.key === FeatureKey.Metadata);
  const schema = await getCatalogSchema(catalog.id);

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-2">
        <nav className="flex items-center gap-1 text-sm text-muted-foreground">
          <Link href="/settings/metadata" className="transition-colors hover:text-foreground">
            Metadata
          </Link>
          <ChevronRight className="size-3.5" aria-hidden />
          <span className="text-foreground">{catalog.name}</span>
        </nav>
        <h1 className="text-2xl font-semibold tracking-tight">{catalog.name}</h1>
      </div>

      <MetadataConfigForm
        catalogId={catalog.id}
        slug={catalog.slug}
        standardEnabled={standard?.catalogEnabled ?? true}
        customEnabled={(custom?.globalEnabled ?? false) && (custom?.catalogEnabled ?? true)}
        customAvailable={custom?.globalEnabled ?? false}
        schema={schema}
      />
    </main>
  );
}
```

- [ ] **Step 2: Client form**

```tsx
// apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FeatureKey, type MetadataSchema } from "@lumio/shared";
import { postJson } from "@/lib/http";
import { apiPaths } from "@/lib/api-paths";
import { catalogApiUrl } from "@/lib/catalog-api";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";

export function MetadataConfigForm({
  catalogId,
  slug,
  standardEnabled,
  customEnabled,
  customAvailable,
  schema,
}: {
  catalogId: string;
  slug: string;
  standardEnabled: boolean;
  customEnabled: boolean;
  customAvailable: boolean;
  schema: MetadataSchema;
}) {
  const router = useRouter();
  const [standard, setStandard] = useState(standardEnabled);
  const [custom, setCustom] = useState(customEnabled);
  const [busy, setBusy] = useState(false);

  async function toggleFeature(key: FeatureKey, next: boolean, set: (v: boolean) => void) {
    set(next);
    try {
      await postJson(apiPaths.features, { key, catalogId, enabled: next }, "PUT");
      router.refresh();
    } catch {
      set(!next);
    }
  }

  async function applyPreset() {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/apply-preset"), { presetId: "nlp" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setBusy(true);
    try {
      await postJson(catalogApiUrl(slug, "/metadata/clear"), {});
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const hasFields = schema.some((g) => g.fields.length > 0);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Display</CardTitle>
          <CardDescription>What appears on photos in this catalog.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="md-standard">Standard metadata</FieldLabel>
              <FieldDescription>Show camera, lens, and exposure from EXIF.</FieldDescription>
            </FieldContent>
            <Switch
              id="md-standard"
              checked={standard}
              onCheckedChange={(v) => toggleFeature(FeatureKey.StandardMetadata, v, setStandard)}
            />
          </Field>
          <Field orientation="horizontal">
            <FieldContent>
              <FieldLabel htmlFor="md-custom">Custom metadata</FieldLabel>
              <FieldDescription>
                {customAvailable
                  ? "Enable user-defined fields (film stock, developer, …)."
                  : "Turn on Photo metadata globally (Settings → Features) to use this."}
              </FieldDescription>
            </FieldContent>
            <Switch
              id="md-custom"
              checked={custom}
              disabled={!customAvailable}
              onCheckedChange={(v) => toggleFeature(FeatureKey.Metadata, v, setCustom)}
            />
          </Field>
        </CardContent>
      </Card>

      {custom && customAvailable && (
        <Card>
          <CardHeader>
            <CardTitle>Custom fields</CardTitle>
            <CardDescription>
              {hasFields
                ? "Fields filled per photo in the Info tab."
                : "Start from the Negative Lab Pro preset."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasFields ? (
              <>
                <div className="space-y-4">
                  {schema
                    .filter((g) => g.fields.length > 0)
                    .map((group) => (
                      <div key={group.id} className="space-y-1.5">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {group.label}
                        </p>
                        <ul className="flex flex-wrap gap-1.5">
                          {group.fields.map((f) => (
                            <li
                              key={f.id}
                              className="rounded-md border border-border bg-background px-2 py-0.5 text-xs"
                            >
                              {f.label}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
                <Button variant="outline" size="sm" disabled={busy} onClick={clear}>
                  Clear all fields
                </Button>
              </>
            ) : (
              <Button disabled={busy} onClick={applyPreset}>
                Apply Negative Lab Pro preset
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`

```bash
git add "apps/web/src/app/(app)/settings/metadata/[id]"
git commit -m "feat(metadata): per-catalog metadata config page (toggles + apply/clear NLP + field list)"
```

---

### Task 5: Verify + browser smoke

- [ ] **Step 1:** `pnpm --filter @lumio/db test -- metadata` (green) and `pnpm --filter @lumio/web exec tsc --noEmit` (clean).
- [ ] **Step 2: Browser smoke** (controller runs this):
  1. Settings → Features → enable **Photo metadata** globally → a **Metadata** entry appears in the settings sidebar.
  2. Settings → Metadata → pick a catalog → **Custom metadata** on → **Apply Negative Lab Pro preset** → field list shows the 4 groups.
  3. Open a photo in that catalog → Info tab → the NLP groups render with empty editable rows; fill one, reload, value persists; autocomplete suggests prior values.
  4. Toggle **Standard metadata** off → the icon-led EXIF block disappears from the Info tab.
  5. **Clear all fields** → Info-tab custom section empties.

---

## Self-review

- **Spec coverage:** sidebar Metadata entry gated on the global feature ✓; per-catalog Standard + Custom toggles ✓; apply NLP preset + clear ✓; read-only field list ✓; Info-tab fill flow now reachable ✓. **Out of scope (1d):** per-field add / rename / reorder / delete / enabled-suggests toggles in the builder, save-as-preset, bulk-fill, upload-time entry.
- **Placeholders:** none.
- **Type consistency:** `getCatalogFeatureStates` → `CatalogFeatureState{key,label,globalEnabled,catalogEnabled}` consumed correctly; `MetadataSchema` from `@lumio/shared`; `apiPaths.features` + `postJson(url,body,method)` + `catalogApiUrl(slug,path)` match their signatures; `clearCatalogSchema(catalogId, db)` matches Task 1.

## Next plan (1d, not this one)

Full per-field builder (add/rename/reorder via `computeReorder`/drag, delete, enabled & suggests toggles), save-as-preset, bulk-fill from grid selection, upload-time entry panel. Then Phase 2 (search + smart albums, salvaging PR #68's engine).
