# Photo Metadata 1e — Choice Options + Builder Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give `choice` fields a defined option list (entered in the builder, rendered as a dropdown when filling), and tidy the builder UI so it reads cleanly instead of as a raw row of inputs.

**Architecture:** Add an `options: string[]` to `MetadataField` (new column + migration, **authored not applied** — the controller applies it surgically to the shared DB). Thread `options` through shared types/presets, the DB layer, and the API routes. In the Info tab, a `choice` field renders as a `<select>` of its options (free text + datalist for other types as today). In the builder, each `choice` field gets an inline options editor; the whole builder card is restyled into clean grouped rows.

**Tech Stack:** Prisma 6 (`String[]` column), TS ESM, Vitest (DI fakes), Next.js routes, React client UI.

---

## ⚠️ Migration guardrail
This adds one column via a new migration file. **Do NOT run `prisma migrate` against the shared dev DB** — author the SQL, run `prisma generate` (safe), unit-test with DI fakes. The controller applies the migration surgically (`prisma db execute` + `migrate resolve --applied`) afterward.

## File structure
- Modify `packages/db/prisma/schema.prisma` — `MetadataField.options String[] @default([])`.
- Create `packages/db/prisma/migrations/20260626120000_metadata_field_options/migration.sql`.
- Modify `packages/shared/src/metadata-resolve.ts` — `options` on `MetadataFieldDef` + `ResolvedField`; pass it through `resolvePhotoMetadata`.
- Modify `packages/shared/src/metadata-presets.ts` — `PresetField.options?: string[]`.
- Modify `packages/shared/src/metadata-preset-nlp.ts` — seed options on the choice fields.
- Modify `packages/db/src/metadata.ts` (+ test) — thread `options` through `getCatalogSchema`, `applyMetadataPreset`, `createMetadataField`, `updateMetadataField`.
- Modify `apps/web/src/app/api/c/[catalog]/metadata/fields/route.ts` and `…/fields/[fieldId]/route.ts` — accept `options`.
- Modify `apps/web/src/features/lightbox/metadata-field-row.tsx` — `choice` → `<select>`.
- Modify `apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx` — options editor + polish.

---

### Task 1: `options` column + migration (authored, NOT applied)

- [ ] **Step 1:** In `schema.prisma`, add to `model MetadataField` (after `suggests`):

```prisma
  options    String[]             @default([])
```

- [ ] **Step 2:** Create `packages/db/prisma/migrations/20260626120000_metadata_field_options/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "MetadataField" ADD COLUMN "options" TEXT[] NOT NULL DEFAULT '{}';
```

- [ ] **Step 3:** `pnpm --filter @lumio/db exec prisma generate` (client now has `options`). Then `pnpm --filter @lumio/db exec prisma validate` → valid. **Do NOT run `prisma migrate`.**

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260626120000_metadata_field_options/migration.sql
git commit -m "feat(metadata): MetadataField.options column + migration (unapplied)"
```

---

### Task 2: Thread `options` through shared

- [ ] **Step 1:** In `metadata-resolve.ts`, add `options: string[]` to **both** `MetadataFieldDef` and `ResolvedField`, and in `resolvePhotoMetadata` copy it onto each resolved field:

```ts
// MetadataFieldDef — add field:
  options: string[];
// ResolvedField — add field:
  options: string[];
// inside the .map, in the returned object add:
  options: f.options,
```

- [ ] **Step 2:** In `metadata-presets.ts`, add to `PresetField`:

```ts
  options?: string[];
```

- [ ] **Step 3:** In `metadata-preset-nlp.ts`, give the four `choice` fields default options. Add an `opts` arg to the local choice builder (or set `.options` inline). Required values:

```
film-format:  ["35mm", "Panoramic", "6×4.5", "6×6", "6×7", "6×9", "4×5", "8×10", "110", "127"]
scan-method:  ["Digital Camera Scan", "Flatbed Scan", "Dedicated Film Scanner", "Lab Scan"]
push-pull:    ["-5", "-4", "-3", "-2", "-1", "0", "+1", "+2", "+3", "+4", "+5"]
developed-at: ["Home", "Lab"]
```

- [ ] **Step 4:** Update `metadata-resolve.test.ts` — the test schema's field objects now need `options: []` (and the resolved-field assertions tolerate the extra key via `toMatchObject`, or add `options` to the expected). Update `metadata-presets.test.ts` — add an assertion that `getPreset("nlp")` has `film-format` with `options.length > 0`.

- [ ] **Step 5:** `pnpm --filter @lumio/shared test` → green. Commit.

```bash
git add packages/shared/src/metadata-resolve.ts packages/shared/src/metadata-resolve.test.ts packages/shared/src/metadata-presets.ts packages/shared/src/metadata-preset-nlp.ts packages/shared/src/metadata-presets.test.ts
git commit -m "feat(metadata): options on field defs + NLP choice-field defaults"
```

---

### Task 3: Thread `options` through the DB layer

**Files:** `packages/db/src/metadata.ts` (+ test).

- [ ] **Step 1:** `getCatalogSchema` — include `options` in the mapped `MetadataFieldDef`:

```ts
      options: f.options ?? [],
```

- [ ] **Step 2:** `applyMetadataPreset` — pass preset options when creating fields:

```ts
          data: {
            catalogId,
            groupId: group.id,
            key: pf.key,
            label: pf.label,
            type: pf.type,
            kind: pf.kind,
            builtinKey: pf.builtinKey ?? null,
            options: pf.options ?? [],
            position: fieldPositions[fi]!,
          },
```

- [ ] **Step 3:** `createMetadataField` — accept an optional `options` param (default `[]`) and store it:

```ts
export async function createMetadataField(
  catalogId: string,
  groupId: string,
  label: string,
  type: string,
  options: string[] = [],
  db: FieldDb = prisma,
): Promise<{ id: string; key: string }> {
  // …existing key/position logic…
  return db.metadataField.create({
    data: { catalogId, groupId, key, label, type, kind: "custom", options, position },
  });
}
```

- [ ] **Step 4:** `updateMetadataField` — allow `options` in its `data` type:

```ts
  data: { label?: string; type?: string; enabled?: boolean; suggests?: boolean; options?: string[] },
```

- [ ] **Step 5:** Update tests: the `createMetadataField` test now calls it with `(…, "text", [], db)` OR keeps the 5-arg form `(…, "text", db)` — since `db` moved to the 6th param, **update the existing call** to `createMetadataField("cat1", "g1", "Film Stock", "text", [], db)`. Add an `updateMetadataField` case allowing `options`. Run `pnpm --filter @lumio/db test -- metadata` → green (ignore the 3 pre-existing mappers failures).

- [ ] **Step 6:** Typecheck db + commit.

```bash
git add packages/db/src/metadata.ts packages/db/src/metadata.test.ts
git commit -m "feat(metadata): thread options through DB layer"
```

---

### Task 4: API routes accept `options`

**Files:** `…/metadata/fields/route.ts`, `…/metadata/fields/[fieldId]/route.ts`.

- [ ] **Step 1:** `fields/route.ts` POST — read `options` (array of non-empty strings) and pass to `createMetadataField`:

```ts
const options = Array.isArray(body?.options) ? body!.options.filter((o): o is string => typeof o === "string" && o.trim() !== "") : [];
// …
const field = await createMetadataField(catalog.id, body.groupId, label, type, options);
```

- [ ] **Step 2:** `fields/[fieldId]/route.ts` PATCH — accept `options`:

```ts
if (Array.isArray(body.options)) data.options = body.options.filter((o: unknown): o is string => typeof o === "string" && o.trim() !== "");
```

(add `options?: string[]` to the `data` local's type and the body cast.)

- [ ] **Step 3:** Typecheck web + commit.

```bash
git add "apps/web/src/app/api/c/[catalog]/metadata/fields"
git commit -m "feat(metadata): field routes accept options"
```

---

### Task 5: Fill UI — `choice` renders as a shadcn `<Select>`

**Files:** `apps/web/src/features/lightbox/metadata-field-row.tsx`.

- [ ] **Step 1: Refactor `save` to take an explicit value** (a shadcn Select commits on selection, before `value` state settles):

```tsx
async function save(next: string = value) {
  if (next === saved.current) return;
  saved.current = next;
  await fetch(catalogApiUrl(slug, `/metadata/photo/${photoId}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fieldId: field.id, value: next }),
  }).catch(() => {});
}
```

Other call sites keep calling `save()` (no arg) on blur — they read the up-to-date `value` state.

- [ ] **Step 2: Imports**

```tsx
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
```

- [ ] **Step 3:** Make `choice` the first branch of the input switch:

```tsx
{field.type === FieldType.Choice && field.options.length > 0 ? (
  <Select value={value || undefined} onValueChange={(v) => { setValue(v); void save(v); }}>
    <SelectTrigger className="h-8 w-40">
      <SelectValue placeholder={isExif && field.value ? field.value : "—"} />
    </SelectTrigger>
    <SelectContent>
      {field.options.map((o) => (
        <SelectItem key={o} value={o}>{o}</SelectItem>
      ))}
    </SelectContent>
  </Select>
) : field.type === FieldType.Textarea ? (
  /* existing textarea branch, unchanged */
) : (
  /* existing input + datalist branch, unchanged */
)}
```

NOTE: a shadcn/Radix `SelectItem` **cannot have `value=""`**, so there's no in-list "clear"; a placeholder shows until first pick. (`value || undefined` keeps the placeholder when empty.) A clear affordance can come later via a sentinel.

- [ ] **Step 4:** Typecheck web + commit.

```bash
git add apps/web/src/features/lightbox/metadata-field-row.tsx
git commit -m "feat(metadata): choice fields render as a shadcn Select in the Info tab"
```

---

### Task 6: Builder — shadcn Table + Select, build-from-scratch, choice options

**Files:** `apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx`.

Render the builder whenever the catalog has **any group** (so you can build from an empty group), and let the empty state start from the NLP preset **or** a blank group. Each group is a shadcn `Table`; the type picker is a shadcn `Select` with **Capitalized** labels (`Text`/`Textarea`/`Number`/`Choice`/`Date`); a `choice` field gets a chip options editor in a sub-row.

- [ ] **Step 1: Imports + helper**

```tsx
import { Fragment } from "react"; // add to the existing react import
import { FieldType } from "@lumio/shared";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
```

- [ ] **Step 2: Branch on groups, not fields.** Replace `const hasFields = …` with `const hasGroups = schema.length > 0;`

- [ ] **Step 3: Replace the `Custom fields` card body** (`CardContent`)

```tsx
<CardContent className="space-y-5">
  {!hasGroups ? (
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy} onClick={applyPreset}>Apply Negative Lab Pro preset</Button>
      <Button variant="outline" disabled={busy} onClick={addGroup}>Add group</Button>
    </div>
  ) : (
    <>
      {schema.map((group) => (
        <div key={group.id} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field</TableHead>
                <TableHead className="w-32">Type</TableHead>
                <TableHead className="w-14">On</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {group.fields.map((f) => (
                <Fragment key={f.id}>
                  <TableRow>
                    <TableCell>
                      <Input
                        defaultValue={f.label}
                        onBlur={(e) => {
                          const label = e.target.value.trim();
                          if (label && label !== f.label) void patchField(f.id, { label });
                        }}
                        className="h-8"
                      />
                    </TableCell>
                    <TableCell>
                      <Select value={f.type} onValueChange={(v) => void patchField(f.id, { type: v })}>
                        <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {Object.values(FieldType).map((t) => (
                            <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={f.enabled}
                        onCheckedChange={(v) => void patchField(f.id, { enabled: v })}
                        aria-label={`${f.label} enabled`}
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.label}`} disabled={busy} onClick={() => void deleteField(f.id)}>
                        <Trash2 aria-hidden />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {f.type === FieldType.Choice && (
                    <TableRow>
                      <TableCell colSpan={4} className="pt-0">
                        <OptionsEditor options={f.options} onChange={(next) => void patchField(f.id, { options: next })} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
          <AddField groupId={group.id} onAdd={addField} busy={busy} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={addGroup}>Add group</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={clear}>Clear all fields</Button>
      </div>
    </>
  )}
</CardContent>
```

(Keep the `applyPreset`/`clear`/`addGroup`/`addField`/`patchField`/`deleteField` handlers from 1d unchanged.)

- [ ] **Step 4: `AddField` uses the shadcn Select** (Capitalized labels)

```tsx
function AddField({ groupId, onAdd, busy }: { groupId: string; onAdd: (groupId: string, label: string, type: string) => Promise<void>; busy: boolean }) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<string>(FieldType.Text);
  const submit = () => { const v = label.trim(); if (v) void onAdd(groupId, v, type).then(() => setLabel("")); };
  return (
    <div className="flex items-center gap-2 pt-1">
      <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Add field…" className="h-8 flex-1"
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
      <Select value={type} onValueChange={setType}>
        <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
        <SelectContent>
          {Object.values(FieldType).map((t) => (<SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" disabled={busy || !label.trim()} onClick={submit}>Add</Button>
    </div>
  );
}
```

- [ ] **Step 5: `OptionsEditor`** (chip list)

```tsx
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {options.map((o) => (
        <span key={o} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-xs">
          {o}
          <button type="button" aria-label={`Remove ${o}`} onClick={() => onChange(options.filter((x) => x !== o))} className="text-muted-foreground hover:text-foreground">×</button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="add option…"
        className="h-6 w-28 rounded-md border border-border bg-background px-2 text-xs"
        onKeyDown={(e) => { const v = draft.trim(); if (e.key === "Enter" && v && !options.includes(v)) { onChange([...options, v]); setDraft(""); } }}
      />
    </div>
  );
}
```

- [ ] **Step 6:** Typecheck web + commit.

```bash
git add "apps/web/src/app/(app)/settings/metadata/[id]/metadata-config-form.tsx"
git commit -m "feat(metadata): builder as shadcn Table + Select, build-from-scratch, choice options"
```

---

### Task 7: Verify

- [ ] **Step 1:** `pnpm --filter @lumio/shared test` (green), `pnpm --filter @lumio/db test -- metadata` (green), `pnpm --filter @lumio/db exec tsc --noEmit` (only pre-existing calendar.ts), `pnpm --filter @lumio/web exec tsc --noEmit` (clean).
- [ ] **Step 2: Browser smoke** (controller, after migration applied): apply NLP → Film Format / Push-Pull / etc. show as dropdowns in the Info tab with the seeded options; add an option to a choice field in the builder → it appears in the dropdown; the builder reads tidily.

---

## Self-review
- **Spec coverage:** `choice` fields get an editable option list + render as a dropdown when filling ✓; builder UI tidied ✓. NLP choice fields ship with sensible defaults ✓.
- **Placeholders:** none.
- **Type consistency:** `options: string[]` added to `MetadataFieldDef`/`ResolvedField`/`PresetField`/`MetadataField` consistently; `createMetadataField` signature change (`options` before `db`) is reflected in its one existing test call and all callers (`applyMetadataPreset` builds the row directly, the route passes `options`). `patchField(id, {options})` flows to the PATCH route → `updateMetadataField`.

## Next (after this): bulk-fill a roll (grid multi-select → set fields once), then drag-reorder / save-as-preset / upload-entry / Phase 2 search.
