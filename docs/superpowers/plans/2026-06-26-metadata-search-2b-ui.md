# Metadata Search — Phase 2b (Search UI) Implementation Plan

> **For agentic workers:** subagent-driven execution. Web has **no React render-test harness**, so each UI task is verified by `tsc --noEmit` + `eslint` + a described **browser check** (not unit tests). Backend is already done (2a) and live (migration applied + backfilled).

**Goal:** Make the search filter panel + token box driven by the catalog's **metadata schema** instead of hardcoded EXIF facets.

**Architecture:** `FilterPanel` iterates `useCatalogMetadataSchema(slug)` enabled fields (grouped by metadata group) and renders one facet per field, chosen by field type/kind. Facets emit/read `FilterRule[]` via the existing `panel-rules.ts` helpers; rules flow through the unchanged `SearchFilters`/`paramsFor` plumbing to the 2a backend (which compiles them via the per-catalog registry). EXIF-specific facets + `/api/exif/*` discovery are retired (spec §2.2 — configured fields only).

**Tech Stack:** Next.js 16 (React 19, `--webpack`), radix-ui, Tailwind, shadcn. All files under `apps/web/src/app/(app)/c/[catalog]/search/` unless noted.

**Spec:** `docs/superpowers/specs/2026-06-26-metadata-search-design.md` (§6 search UI). **Exploration of the inherited UI is the source of truth for existing shapes.**

## Facet ↔ field mapping (the core design)

| Field | Facet | Ops emitted | Values source |
|---|---|---|---|
| **choice** (custom) | `FacetMultiselect` + `staticOptions` | `in_list` | `field.options` (from schema) |
| **text / textarea** (custom) | **`FacetText`** (new) | `contains` | autocomplete via `/metadata/suggest` (`suggests`) |
| **standard string** (camera, lens) | **`FacetText`** (new) | `contains` | autocomplete (suggest returns override values; `contains` matches the effective value at the backend) |
| **standard number** (iso, aperture, focal, shutter) | `FacetRange` (reuse) | `between`/`gte`/`lte` | — |
| **standard date** (date) | `FacetDate` (reuse + `fieldKey` prop) | `between`/`gte`/`lte` | — |
| **custom number / date** | **`FacetEquality`** (new) | `eq` | number/date `<input>` (no range — spec §2.4) |

The match (all/any) toggle stays at the panel top (unchanged).

## File structure
- **New:** `use-metadata-values.ts` (discovery hook), `facet-text.tsx`, `facet-equality.tsx`, `metadata-facets.tsx` (the schema-driven facet-list builder).
- **Modify:** `facet-multiselect.tsx` (add `staticOptions`), `facet-date.tsx` + `panel-rules.ts` (parameterize date by `fieldKey`), `filter-panel.tsx` (replace hardcoded facets with the schema-driven builder; gate on feature+hasMeta).
- **Remove (dead after rewrite):** `facet-toggles.tsx`, `facet-generic.tsx`, `use-exif-discovery.ts`(+test), `apps/web/src/app/api/exif/fields/route.ts`, `apps/web/src/app/api/exif/values/route.ts`, `apps/web/src/lib/exif-discovery.ts`(+test) — only after confirming no remaining imports.

---

## Task 1 — Discovery hook + `FacetText` (custom text / standard string → contains)

**Files:** Create `use-metadata-values.ts`, `facet-text.tsx`.

- [ ] **Step 1: `useMetadataValues` hook.** Create `use-metadata-values.ts`. Mirror `use-exif-discovery.ts`'s structure (local `useState` + `useEffect` + cancel flag), but fetch the existing metadata suggest endpoint and return `string[]`:
```ts
"use client";
import { useEffect, useState } from "react";
import { catalogApiUrl } from "@/lib/catalog-api";

/** Distinct prior values for a custom field, for autocomplete. Empty until loaded. */
export function useMetadataValues(slug: string, fieldId: string | null, query: string): string[] {
  const [values, setValues] = useState<string[]>([]);
  useEffect(() => {
    if (!fieldId) { setValues([]); return; }
    let alive = true;
    const q = query.trim();
    fetch(catalogApiUrl(slug, `/metadata/suggest?field=${encodeURIComponent(fieldId)}${q ? `&q=${encodeURIComponent(q)}` : ""}`))
      .then((r) => (r.ok ? (r.json() as Promise<{ values: string[] }>) : { values: [] }))
      .then((d) => { if (alive) setValues(d.values ?? []); })
      .catch(() => { if (alive) setValues([]); });
    return () => { alive = false; };
  }, [slug, fieldId, query]);
  return values;
}
```

- [ ] **Step 2: `FacetText`.** Create `facet-text.tsx`. A labeled text input that emits a single `contains` rule on the field key and offers an autocomplete dropdown from `useMetadataValues` (when `suggests`). Read current value via a small inline helper (the rule with op `contains` for this field). Props:
```ts
{ label: string; fieldKey: string; fieldId: string; suggests: boolean; slug: string;
  rules: FilterRule[]; onRules: (next: FilterRule[]) => void }
```
- current value = `rules.find(r => r.field === fieldKey && r.op === RuleOp.contains)?.value as string ?? ""`.
- on change/commit: drop any existing rule for `fieldKey`, and if the trimmed value is non-empty push `{ field: fieldKey, op: RuleOp.contains, value }`.
- autocomplete: when focused + `suggests`, show `useMetadataValues(slug, fieldId, value)` as a clickable dropdown (reuse the dropdown styling from `metadata-value-input.tsx`'s Autocomplete — same `absolute … rounded-md border bg-popover` list). Picking sets the value + commits.

- [ ] **Step 3: Verify** — `pnpm --filter @lumio/web exec tsc --noEmit` clean for these files; `eslint` clean (watch the react-hooks/exhaustive-deps + set-state-in-effect rules — the hook's effect only setStates inside the async `.then`, which is allowed).

- [ ] **Step 4: Commit** — `feat(search): metadata value-discovery hook + text-contains facet`.

---

## Task 2 — Reused-facet tweaks + `FacetEquality`

**Files:** Modify `facet-multiselect.tsx`, `facet-date.tsx`, `panel-rules.ts`; Create `facet-equality.tsx`.

- [ ] **Step 1: `FacetMultiselect` `staticOptions`.** Add an optional `staticOptions?: string[]` prop. When provided, render those as the checkbox list (mapped to `{value, count:0}` shape or adapt the list type to plain strings) and SKIP `useExifValues`. Keep the existing client-side text filter over the list. The emit path stays `applyMultiselect(rules, fieldKey, values)` → `in_list`. (The `field`/discovery prop becomes optional; choice fields pass `staticOptions={options}` and omit it.)

- [ ] **Step 2: Parameterize `FacetDate` by field.** `readDateRange`/`applyDateRange` in `panel-rules.ts` currently hardwire `"takenAt"`. Add a `field: string` param to both. Update `facet-date.tsx` to take a `fieldKey` + `label` prop and pass it through. (Existing single call site — the EXIF panel — is being replaced in Task 3, so no other caller breaks.)

- [ ] **Step 3: `FacetEquality`** (custom number/date → `eq`). Create `facet-equality.tsx`: a labeled single `<input>` (`type="number"` for number, `type="date"` for date) emitting one `eq` rule on the field key (drop existing rule for the field; push `{field, op: eq, value}` where value is the number or ISO date string). Props: `{ label; fieldKey; inputType: "number" | "date"; rules; onRules }`.

- [ ] **Step 4: Verify** tsc + eslint clean.

- [ ] **Step 5: Commit** — `feat(search): choice/number/date facets for metadata fields`.

---

## Task 3 — Schema-driven facet list + wire into `FilterPanel`

**Files:** Create `metadata-facets.tsx`; Modify `filter-panel.tsx`.

- [ ] **Step 1: `MetadataFacets` builder.** Create `metadata-facets.tsx`: `function MetadataFacets({ groups, slug, rules, onRules })` where `groups: MetadataSchema`. For each group (render the group `label` as a small header, matching the Info-tab grouping), iterate `group.fields.filter(f => f.enabled)` and render the facet per the mapping table:
  - `kind === Standard`: string builtinKey (camera/lens) → `FacetText`; iso/aperture/focal/shutter → `FacetRange` (with `step="0.1"` for aperture); date → `FacetDate`.
  - `kind === Custom`: `type === Choice` → `FacetMultiselect staticOptions={f.options}`; `Text`/`Textarea` → `FacetText`; `Number` → `FacetEquality inputType="number"`; `Date` → `FacetEquality inputType="date"`.
  - Pass `fieldKey={f.key}`, `fieldId={f.id}`, `label={f.label}`, `suggests={f.suggests}`, `slug`, `rules`, `onRules`.
  - Determining standard string vs number: use `f.builtinKey` against `StandardFieldKey` (Camera/Lens → text; Iso/Shutter/Aperture/Focal → range; Date → date). Reuse `STANDARD_COLUMN[builtinKey].valueType` from `@lumio/shared` to pick range vs text, or a small local switch.

- [ ] **Step 2: Rewrite `FilterPanel` body.** Replace the six hardcoded facet lines (filter-panel.tsx:46–53) with `<MetadataFacets groups={enabledGroups} slug={slug} rules={filters.rules} onRules={setRules} />`. Get the schema via `useCatalogMetadataSchema(slug)` (slug from `useCatalog()`); compute `enabledGroups = (schema ?? []).map(g => ({...g, fields: g.fields.filter(f=>f.enabled)})).filter(g => g.fields.length)`. Keep the match toggle + active-count badge. Keep `FacetGeneric`? No — remove it (raw-exif retired).

- [ ] **Step 3: Gate the panel.** In `search-view.tsx` (or wherever `<FilterPanel>` is rendered), only render it when the Metadata feature is enabled AND the catalog has ≥1 enabled field (`hasMeta`). Use the existing `useFeature`/`FeatureGate` + `useCatalogMetadataSchema`. If no metadata fields, the panel button is hidden (search still has the token box + album/q).

- [ ] **Step 4: Verify** tsc + eslint clean.

- [ ] **Step 5: Browser check (CONTROLLER will do this).** On a catalog with the NLP preset: open search → the filter button shows → panel lists Equipment/Shooting/etc. groups with the right facet per field. Pick a choice value, type a text value → chips/rules appear, results filter. Screenshot.

- [ ] **Step 6: Commit** — `feat(search): schema-driven metadata filter panel`.

---

## Task 4 — Retire dead EXIF UI + discovery

**Files:** Remove the EXIF-only files (only after grep confirms no imports remain): `facet-toggles.tsx`, `facet-generic.tsx`, `use-exif-discovery.ts`(+`.test.ts`), `app/api/exif/fields/route.ts`, `app/api/exif/values/route.ts`, `lib/exif-discovery.ts`(+`.test.ts`).

- [ ] **Step 1:** `grep -rn` each module's exports across `apps/web/src` to confirm no remaining importers (after Task 3, `FilterPanel` no longer imports them). If `FacetMultiselect` still imports `useExifValues`, ensure the `staticOptions` path made it optional and the only caller now passes `staticOptions` — then the `useExifValues` import can be dropped too (and if nothing else uses it, remove the hook).
- [ ] **Step 2:** Delete the confirmed-dead files. Run `tsc` + `eslint` + the full web build-adjacent check (`tsc` across web).
- [ ] **Step 3: Commit** — `chore(search): remove retired EXIF facets + discovery (metadata-only search)`.

---

## Task 5 — Full verification

- [ ] `pnpm --filter @lumio/web exec tsc --noEmit` → clean (no `error TS` outside `.next/`).
- [ ] `pnpm --filter @lumio/web exec eslint src/app/\(app\)/c/\[catalog\]/search` → clean.
- [ ] `pnpm --filter @lumio/shared test` + `@lumio/db test` → still green (no backend regressions).
- [ ] **Browser end-to-end (controller):** choice `in_list`, text `contains`, standard `between` (iso) — each filters correctly and round-trips through a saved/recalled search. Token box `film-stock:Portra` still works.

---

## Notes / deferred
- Token-box chip labels for metadata fields fall back to the field `key` via `formatRuleLabel` (it uses the static registry). Prettifying to the field `label` is a later polish (would need `formatRuleLabel` to accept a label map).
- Smart-album rule builder over metadata fields = **2c** (also unlocks persisting metadata smart-album rules — the write-schema gap from 2a's review).
