# EXIF Search UI — Phase 2b: Facet Panel — Design

**Date:** 2026-06-20
**Status:** Approved (pending spec review)
**Builds on:** Phase 1 (backend engine) + Phase 2a (token-driven filters), branch `gego/charlottetown`.
**Parent spec:** `docs/superpowers/specs/2026-06-20-exif-search-design.md`

## Summary

Add the **facet panel** half of the hybrid EXIF search UI: a popover, opened from a
filter button in the search toolbar, with tailored widgets for the common fields
(camera/lens multiselect with live counts, ISO/aperture/focal-length ranges, date
range, has-location/orientation toggles) plus a generic "＋ Add filter" row for any
EXIF key. EXIF rules become **removable chips inside the search box** (like the
existing `@album` chips); typed tokens and panel selections produce the *same* chips,
keeping the box the single source of truth. A small backend addition — an `in`/`not_in`
operator — lets a multiselect mean "camera = A or B."

## Goals

- A discoverable facet panel that builds the same `FilterSet` the token box does.
- Multiselect (camera/lens) with distinct values + counts from `/api/exif/values`.
- Numeric ranges (ISO/aperture/focal), date range, and boolean toggles.
- A generic field/op/value row driven by `/api/exif/fields` — any EXIF key.
- An all/any (match) toggle for the whole filter set.
- EXIF rules as **removable chips** in the box; panel and typed tokens stay in sync
  through one source of truth.

## Non-Goals (deferred)

- Place-name reverse-geocoding; UI to view/manage promoted columns (own features).
- Saving a search as a smart album / reusing widgets in the rule-builder (Phase 3).
- A map/bounding-box GPS picker (v1 GPS is the has-location toggle only).
- A calendar date picker (v1 uses native date inputs); a range slider (v1 uses
  min/max number inputs).

## Architecture

### 1. Source of truth: removable inline chips (the "A model")

EXIF rules render as removable chips **inside** the contenteditable search box,
mirroring how `@album` chips already work (`search-input.tsx`). The box text remains
the single source of truth.

- Each EXIF chip carries `data-facet="exif"` and `data-token="<ruleToToken(rule)>"`
  (e.g. `iso:>800`), with `formatRuleLabel(rule)` as its visible label.
- `readEditor` collects: album chips → `albums`; EXIF chip `data-token`s → token
  strings; remaining text nodes → free text. It then runs
  `parseFilterTokens(exifTokens.join(" ") + " " + freeText)` → `{ rules, q }`. So a
  rule contributes whether it's already a chip **or** still being typed (2a's live
  filtering is preserved).
- On **Space/Enter**, any complete recognized token in the free text is upgraded into
  a chip (visual only — the resulting rules are identical either way).
- The panel inserts a chip by computing `ruleToToken(rule)` → `data-token` and
  `formatRuleLabel(rule)` → label, reusing the existing `chipHtml`/insert path.
- Chip removal (× button / Backspace) drops the rule, via the existing chip-removal
  handling in `search-input.tsx`.

Net effect: `SearchFilters` (from Phase 2a: `{ albums, q, rules }`) is unchanged; only
the box's chip rendering/reading and the new panel feed it.

### 2. Backend addition: `in` / `not_in` operator

A multiselect over one field (camera = A **or** B) cannot be expressed as two AND'd
`eq` rules in a flat `FilterSet`. Add an in-list operator:

- `RuleOp.in` / `RuleOp.not_in` (value: `string[]`) in `@lumio/shared/enums.ts`.
- `buildPhotoWhere` (`@lumio/db/photo-where.ts`): for a **column** field,
  `in` → `{ [col]: { in: values } }`, `not_in` → `{ [col]: { notIn: values } }`.
  (Promoted string columns only; not offered for JSON keys in v1.)
- Field registry: string **column** fields (camera, lens, cameraMake) gain `in`/`not_in`
  in their `ops`. (`album` keeps its dedicated `in_album`/`not_in_album`.)
- `filterSetSchema`: `in`/`not_in` require a non-empty `string[]` (same shape rule as
  the album ops).
- Token grammar: `camera:Sony,Nikon` → `in ["Sony","Nikon"]` (comma-separated,
  unquoted; quoted whole-value keeps commas literal). `ruleToToken` emits the same;
  round-trips. `formatRuleLabel`: "Camera is Sony or Nikon" (`not_in` → "Camera is not …").

This is the only change reaching back into the Phase-1 engine packages.

### 3. The panel (popover off a toolbar filter button)

A `FilterPanel` component opened by a "Filters" button placed beside the existing
view/size/sort menus in `search-view.tsx`'s toolbar. The popover holds labelled
sections; each reads the current `filters.rules` to pre-fill, and emits rule
mutations (add/replace/remove for its field) back to `SearchView`, which re-renders
the box chips. Sections:

| Section | Widget | Emits |
| --- | --- | --- |
| Camera, Lens | search input + scrollable checkbox list of values + counts | one `in` rule per field |
| ISO, Aperture, Focal length | min / max number inputs | `between` (both), `gte`/`lte` (one) |
| Date taken | from / to native date inputs | `between`/`gte`/`lte` (ISO values) |
| Has location | toggle | `hasGps eq true` |
| Orientation | toggle / segmented (portrait \| landscape) | `orientation` rule (see note) |
| ＋ Add filter | field picker → op picker → value | the chosen rule |
| Match all / any | toggle | sets `FilterSet.match` |

Orientation note: `orientation` is a JSONB field (EXIF orientation enum 1–8). v1 maps
portrait = orientation `in` the 90°/270° set and landscape = the rest; if that proves
awkward, fall back to deriving from `width`/`height` — decided during the plan. Keep it
behind one toggle either way.

The all/any toggle controls the `match` passed in the `filter` param; Phase-1's
`buildSearchWhere` already ANDs album/q with the filter group and respects its `match`.

### 4. Pure mapping layer (the testable core)

To keep the React panel thin and TDD the logic, two pure helpers (location TBD during
plan — likely `apps/web/src/app/(app)/search/panel-rules.ts`):

- `readPanelField(rules, fieldKey)` → the current widget value for a field (e.g. the
  selected camera array, the {min,max} for iso) by finding that field's rule(s).
- `applyPanelField(rules, fieldKey, widgetValue)` → a new `rules` array with that
  field's rule replaced/removed to match the widget (others untouched).

These make "widget ↔ rules" conversions unit-testable without rendering.

### 5. Discovery wiring

Client hooks `useExifFields()` and `useExifValues(field)` calling the existing
`/api/exif/fields` and `/api/exif/values?field=…` (already cached + auth'd server-side
from Phase 1). The multiselect lists render `value (count)`, sorted by count desc.
Loading/empty/error states degrade to an empty list (the endpoints already return `[]`
on error).

### 6. New shadcn primitives

Add **checkbox** via the shadcn MCP (multiselect lists; toggles can reuse the existing
`switch`). Reuse existing `popover`, `input`, `switch`, `dropdown-menu`, `button`,
`badge`. A searchable multiselect is `input` + a scrollable checkbox list — no need for
the full `command` component. Per house rule, do not modify `ui/*`; copy styles if a
variant is needed.

## Data Flow

```
panel widget → applyPanelField(rules, field, value) → new rules
   → SearchView setFilters({albums, q, rules, match})
   → box re-renders EXIF chips (ruleToToken/formatRuleLabel)
   → paramsFor → ?filter={match, rules} → /api/search (Phase 1)
typed token → Space/Enter → chip (data-token) ─┐
box edit/chip remove → readEditor → parseFilterTokens → rules ┘ (same rules)
panel open → readPanelField(rules, field) pre-fills each widget
```

(`SearchFilters` gains a `match` field, defaulting to `all`; `paramsFor`/`serialize`
carry it. The 2a read-only chip row is replaced by the in-box removable chips.)

## Error Handling

- Discovery endpoints failing → empty value lists; the panel still works for typed/
  range/toggle inputs.
- A malformed/over-long multiselect or generic value is validated by `filterSetSchema`
  at the API boundary (Phase 1) → 400; the UI only ever constructs valid rules via the
  mapping helpers, so this is defense-in-depth.
- Removing the last value from a multiselect drops the whole `in` rule (no empty `in`).

## Testing

**Pure unit (no DB / no render):**
- `RuleOp.in`/`not_in`: `buildPhotoWhere` column compilation; `filterSetSchema`
  string[] validation; token round-trip (`camera:Sony,Nikon` ↔ rule); `formatRuleLabel`.
- `readPanelField` / `applyPanelField` for each widget type (multiselect, numeric
  range, date range, toggle, generic), including add/replace/remove and the
  drop-empty-`in` case.
- `SearchFilters.match` through `paramsFor`/`serialize`.

**Integration:** discovery hooks against mocked fetch; `searchPhotos` with an `in` rule
against a seeded DB.

**Browser smoke (manual / Claude-in-Chrome):** open the panel, pick two cameras +
an ISO range → grid filters, chips appear in the box and are removable, typed tokens
and panel selections interoperate, the `filter` param carries the combined set.

## Affected / New Files (sketch)

- `packages/shared/src/enums.ts` — `RuleOp.in`/`not_in`.
- `packages/shared/src/filters.ts` — registry ops + `filterSetSchema` for in-list.
- `packages/shared/src/filter-tokens.ts` — comma-list parse/serialize + label.
- `packages/db/src/photo-where.ts` — `in`/`notIn` column compilation.
- `apps/web/src/components/ui/checkbox.tsx` *(new, via shadcn)*.
- `apps/web/src/app/(app)/search/filter-panel.tsx` *(new)* + per-widget subcomponents.
- `apps/web/src/app/(app)/search/panel-rules.ts` *(new)* — `readPanelField`/`applyPanelField`.
- `apps/web/src/app/(app)/search/use-exif-discovery.ts` *(new)* — fields/values hooks.
- `apps/web/src/app/(app)/search/filters.ts` — `SearchFilters.match` + `paramsFor`.
- `apps/web/src/app/(app)/search/search-input.tsx` — EXIF chips (insert/read/remove).
- `apps/web/src/app/(app)/search/search-view.tsx` — toolbar Filters button + panel; drop the 2a read-only chip row.

## Open Decisions (defaults chosen; flag during review)

1. **`in`/`not_in` added** for multiselect (vs. single-select). ✅ confirmed.
2. **Numeric ranges = min/max inputs** (vs. slider needing fetched bounds). ✅ confirmed.
3. **Orientation** mapping (EXIF enum vs. width/height) — resolve in the plan; one
   toggle either way.
4. **Whole panel in one plan** (vs. 2b-i/2b-ii split). ✅ confirmed: one pass.
