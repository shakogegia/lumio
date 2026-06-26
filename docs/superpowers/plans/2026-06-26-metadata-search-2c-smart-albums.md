# Metadata Search — Phase 2c (Smart Albums over Metadata) Implementation Plan

> Subagent-driven. Backend tasks are DI-unit-testable; UI tasks are tsc+eslint verified (no render harness) + the user's browser pass.

**Goal:** Let users build smart-album rules over the catalog's **metadata fields** (custom + standard) and persist them — for both *new* smart albums and *editing existing* ones. The read/compile path (`smartAlbumWhere` → `buildPhotoWhere` + registry) is already metadata-aware (2a); 2c adds the **write** schema, route validation, and the **rule-builder UI** (reusing 2b's `MetadataFacets`).

**Architecture:** A smart album's `rules` is a `FilterSet { match, rules: FilterRule[] }` (same shape the 2b panel already produces). Replace the hardcoded 2-variant `smartRuleSchema` with `filterSetSchema`; validate rule fields/ops against the per-catalog registry in the album create/update routes (reject unknown — these are deliberate, persisted rules). UI: extract a `SmartAlbumRulesEditor` (match toggle + `MetadataFacets`) used by the create dialog and a new edit-rules dialog.

**Spec:** `docs/superpowers/specs/2026-06-26-metadata-search-design.md` §7. **Exploration is the source of truth for current shapes.**

## Key current shapes (from exploration)
- `packages/shared/src/albums.ts`: `smartRuleSchema = z.discriminatedUnion("field",[last30,cameraEq])`; `createAlbumSchema = { name, isSmart, rules: smartRulesSchema.optional(), folderId }.refine(isSmart ⇔ rules)`.
- `packages/shared/src/types.ts`: `SmartAlbumRule { field; op; value?: string|number }`, `SmartAlbumRules { match; rules: SmartAlbumRule[] }`. (Narrow `value` — must widen to `FilterValue`.)
- POST `apps/web/src/app/api/c/[catalog]/albums/route.ts` → `parseJson(req, createAlbumSchema)` → `createAlbum(catalog.id, data)`. `catalog.id` in scope; no registry check today.
- PATCH `apps/web/src/app/api/c/[catalog]/albums/[id]/route.ts` → only `renameAlbumSchema` / `setAlbumCoverSchema`. **No rules update.**
- `apps/web/src/app/(app)/c/[catalog]/albums/new-album-dialog.tsx` → bespoke 2-type rule form (`RuleType = "last_30_days"|"camera_eq"`). POSTs to `/albums`.
- `albums-service.ts`: `createAlbum` writes `rules: input.rules as object`. DTO `toAlbumDTO` (`mappers.ts:64`) returns `rules: (row.rules as SmartAlbumRules) ?? null`.
- Reuse: `MetadataFacets({ groups, slug, rules: FilterRule[], onRules })`; `useCatalogMetadataSchema(slug)`.

---

## Task 1 — Backend: schema + types + route validation (create & update)

**Files:** `packages/shared/src/types.ts`, `packages/shared/src/albums.ts`, `apps/web/src/lib/server/albums-service.ts`, `apps/web/src/app/api/c/[catalog]/albums/route.ts`, `apps/web/src/app/api/c/[catalog]/albums/[id]/route.ts`; tests in `packages/db` if a service fn is added.

- [ ] **Step 1: Widen the rule value type.** In `types.ts`, make `SmartAlbumRules`/`SmartAlbumRule` carry the full filter value. Cleanest: reuse `FilterRule`. Check for an import cycle (`filters.ts` must NOT import `types.ts`); if clean:
```ts
import type { FilterRule, FilterValue } from "./filters.js";
export type SmartAlbumRule = FilterRule;
export interface SmartAlbumRules { match: MatchType; rules: SmartAlbumRule[]; }
```
If a cycle exists, instead widen inline: `value?: FilterValue` (import only the `FilterValue` type). Keep `SmartAlbumRules` otherwise unchanged. Update any code that broke from the wider type (the engine already accepts it).

- [ ] **Step 2: Replace `smartRuleSchema` with the filter schema.** In `albums.ts`, drop `last30`/`cameraEq`/`smartRuleSchema`/`smartRulesSchema` and use `filterSetSchema` (from `./filters.js`) for the rules:
```ts
import { filterSetSchema } from "./filters.js";
export const createAlbumSchema = z.object({
  name: z.string().min(1).max(200),
  isSmart: z.boolean().default(false),
  rules: filterSetSchema.optional(),
  folderId: z.string().min(1).nullish(),
}).refine((v) => (v.isSmart ? !!v.rules && v.rules.rules.length > 0 : !v.rules),
  { message: "smart albums require at least one rule; plain albums must omit rules" });

export const updateSmartAlbumRulesSchema = z.object({ rules: filterSetSchema });
```
Export `updateSmartAlbumRulesSchema`. Note `filterSetSchema`'s `superRefine` is already registry-permissive for unknown (metadata) field keys (2a fix), so metadata rules pass structural validation here; the per-catalog op/field check happens in the route (next step).

- [ ] **Step 3: Per-catalog validation helper.** Add to `albums-service.ts` (or a small shared spot) a function that rejects rules whose field isn't a configured metadata field or whose op isn't allowed for it:
```ts
import { buildSearchRegistry } from "@lumio/shared";
import { getCatalogSchema } from "@lumio/db";
/** Returns the names of rules invalid for this catalog (empty = all valid). */
export async function invalidRuleFields(catalogId: string, rules: { field: string; op: string }[]): Promise<string[]> {
  const registry = buildSearchRegistry(await getCatalogSchema(catalogId));
  return rules
    .filter((r) => { const d = registry.get(r.field); return !d || (d.ops.length > 0 && !d.ops.includes(r.op as never)); })
    .map((r) => r.field);
}
```
(Legacy `album`/`filename`/`exif.*` are NOT valid smart-album fields — smart albums filter on configured metadata fields only, consistent with §2.2.)

- [ ] **Step 4: Validate on create.** In the albums POST route, after parsing, when `data.isSmart && data.rules`, call `invalidRuleFields(catalog.id, data.rules.rules)`; if non-empty, return `errorJson("Unknown filter field(s): " + bad.join(", "), 400)`. Otherwise proceed to `createAlbum`.

- [ ] **Step 5: Add the PATCH rules branch.** In `albums/[id]/route.ts`, accept `updateSmartAlbumRulesSchema` (a body with `rules`). Validate via `invalidRuleFields`; then call a new `updateAlbumRules(catalog.id, id, rules)` in `albums-service.ts` that updates `Album.rules` (only for an `isSmart` album in that catalog — guard: load the album, 404 if missing, 400 if not smart). Return the updated album DTO. (Follow the existing PATCH branching style — it already switches on which schema matched.)

- [ ] **Step 6: Tests.** Add DI unit tests for `updateAlbumRules` (updates the row's `rules`; guards non-smart) and `invalidRuleFields` (valid metadata rule passes; unknown field flagged; bad op flagged) in `packages/db` style (fake `db`). Run `pnpm --filter @lumio/db test`. Typecheck shared + db + web.

- [ ] **Step 7: Commit** — `feat(albums): accept + persist metadata smart-album rules (registry-validated)`.

---

## Task 2 — UI: `SmartAlbumRulesEditor` + new-album dialog

**Files:** Create `apps/web/src/app/(app)/c/[catalog]/albums/smart-album-rules-editor.tsx`; modify `new-album-dialog.tsx`.

- [ ] **Step 1: `SmartAlbumRulesEditor`.** A controlled editor for `{ match, rules }`:
```ts
{ value: { match: MatchType; rules: FilterRule[] };
  onChange: (next: { match: MatchType; rules: FilterRule[] }) => void }
```
- `const { slug } = useCatalog(); const schema = useCatalogMetadataSchema(slug);`
- `const enabledGroups = (schema ?? []).map(g => ({...g, fields: g.fields.filter(f=>f.enabled)})).filter(g=>g.fields.length);`
- If `enabledGroups.length === 0`: render a muted hint "This catalog has no metadata fields to filter on. Add fields in Settings → Metadata." (smart albums over metadata need fields).
- Else: a match toggle (all/any — copy the control from `filter-panel.tsx`) calling `onChange({ ...value, match })`, then `<MetadataFacets groups={enabledGroups} slug={slug} rules={value.rules} onRules={(rules) => onChange({ ...value, rules })} />`.

- [ ] **Step 2: Wire into `new-album-dialog.tsx`.** Replace the bespoke `RuleType`/`RuleRow` form + its match `<select>` with local state `const [smart, setSmart] = useState<{match: MatchType; rules: FilterRule[]}>({ match: MatchType.all, rules: [] })` and `<SmartAlbumRulesEditor value={smart} onChange={setSmart} />`, shown only when the "smart album" toggle is on. On submit, POST `{ name, isSmart: true, rules: smart, folderId }`. Disable submit when `isSmart && smart.rules.length === 0`. Keep the plain-album path unchanged.

- [ ] **Step 3: Verify** tsc + eslint clean for both files.

- [ ] **Step 4: Commit** — `feat(albums): metadata rule builder in the new-album dialog`.

---

## Task 3 — UI: edit rules on an existing smart album

**Files:** Create `apps/web/src/app/(app)/c/[catalog]/albums/edit-rules-dialog.tsx`; wire an entry point (`album-card.tsx` context menu and/or `album-view.tsx` header); ensure the album `rules` reach the entry point.

- [ ] **Step 1: `EditRulesDialog`.** A shadcn `Dialog` holding `SmartAlbumRulesEditor` seeded from the album's current `rules` (`{ match, rules }`), with a Save button that `PATCH`es `catalogApiUrl(slug, "/albums/"+albumId)` with `{ rules: state }` via `patchJson`, then `router.refresh()` + toast. Props: `{ albumId; initial: { match; rules }; open; onOpenChange }`.

- [ ] **Step 2: Entry point.** Add an "Edit rules" item to the smart-album affordances — in `album-card.tsx`'s context menu (only when `isSmart`) and/or the album detail header (`album-view.tsx`). It needs the album's `rules`: confirm the album DTO already carries `rules` (it does — `toAlbumDTO`), and thread `rules` into whichever component renders the menu/header (add a prop if missing). Opening the item opens `EditRulesDialog` with `initial = rules ?? { match: MatchType.all, rules: [] }`.

- [ ] **Step 3: Verify** tsc + eslint clean.

- [ ] **Step 4: Commit** — `feat(albums): edit smart-album metadata rules`.

---

## Task 4 — Full verification

- [ ] `pnpm --filter @lumio/shared test` + `@lumio/db test` → green (incl. the new Task 1 tests).
- [ ] `tsc --noEmit` clean in shared, db, web; `eslint` clean in `albums/` + `api/c/[catalog]/albums/`.
- [ ] **Browser (user):** create a smart album with a metadata rule (e.g. Film Format = 6×6) → it lists the matching photos; edit its rules → membership updates; a catalog with no metadata fields shows the "add fields" hint instead of facets.

## Notes / deferred
- Smart-album rule chips/labels share the 2b token-label limitation (field key vs label) — cosmetic.
- `SmartAlbumRule.value` widening may touch a couple of call sites that assumed `string|number`; fix them to the wider type (the engine already handles it).
