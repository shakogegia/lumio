# EXIF Search UI — Phase 2b: Facet Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a facet panel (popover off the search toolbar) with camera/lens
multiselect (+counts), ISO/aperture/focal ranges, date range, has-location/orientation
toggles, a generic "＋ Add filter" row, and an all/any toggle — all producing the same
**removable EXIF chips inside the search box** that typed tokens do.

**Architecture:** EXIF rules become removable chips in the contenteditable box (like
`@album` chips), each storing its rule as JSON in `data-rule`. `readEditor` merges
JSON-chip rules with `parseFilterTokens(freeText)`; `applyFilters` re-renders the box
from a `SearchFilters` as chips (the inverse). The panel never touches the DOM directly —
it computes a new `SearchFilters` via pure `readPanelField`/`applyPanelField` helpers and
calls `inputRef.applyFilters(next)`. A small backend addition (`RuleOp.in`/`not_in`) lets
a multiselect mean "camera = A or B".

**Tech Stack:** TypeScript (ESM `.js` specifiers), Vitest, React 19 / Next 16, `@lumio/shared`
field registry + `FilterSet`, Prisma 6, shadcn (Base UI) components.

**Spec:** `docs/superpowers/specs/2026-06-20-exif-search-2b-facet-panel-design.md`
**Builds on:** Phase 1 (engine) + Phase 2a (token filters). `SearchFilters` is currently
`{ albums: string[]; q: string; rules: FilterRule[] }`; this plan adds `match`.

**Refinement vs spec:** chips carry `data-rule` (JSON), not `data-token`; the typed
`in`-list grammar (`camera:A,B`) is deferred — multiselect is panel-only in v1. Everything
else matches the spec.

**Conventions:** local imports use `.js`. Run one test file with
`pnpm --filter <pkg> exec vitest run <relative-path>`. Web has no `typecheck` script — use
`pnpm --filter @lumio/web exec tsc --noEmit`. The `(app)` path segment needs quoting in shell.
Commit after each task. Don't modify `components/ui/*` beyond adding new shadcn files.

---

## Part A — Backend: the `in` / `not_in` operator

### Task 1: `RuleOp.in` / `not_in` — enum, registry, schema (shared)

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Modify: `packages/shared/src/filters.ts`
- Modify: `packages/shared/src/filters.test.ts`

- [ ] **Step 1: Add the enum members.** In `packages/shared/src/enums.ts`, add `in_list` and `not_in_list` to `RuleOp` (named to avoid the JS reserved word `in`):

```ts
  in_list = "in_list",
  not_in_list = "not_in_list",
```
(Place them after `not_in_album`, before `last_30_days`.)

- [ ] **Step 2: Write failing registry + schema tests (append to `filters.test.ts`).**

```ts
describe("in_list operator", () => {
  it("string column fields allow in_list / not_in_list", () => {
    expect(resolveField("camera").ops).toContain(RuleOp.in_list);
    expect(resolveField("lens").ops).toContain(RuleOp.not_in_list);
    expect(resolveField("cameraMake").ops).toContain(RuleOp.in_list);
  });

  it("number/json/album fields do NOT get in_list", () => {
    expect(resolveField("iso").ops).not.toContain(RuleOp.in_list);
    expect(resolveField("album").ops).not.toContain(RuleOp.in_list);
    expect(resolveField("exif.LightSource").ops).not.toContain(RuleOp.in_list);
  });

  it("filterSetSchema accepts in_list with a non-empty string[]", () => {
    const ok = filterSetSchema.safeParse({
      match: MatchType.all,
      rules: [{ field: "camera", op: RuleOp.in_list, value: ["Sony", "Nikon"] }],
    });
    expect(ok.success).toBe(true);
  });

  it("filterSetSchema rejects in_list with an empty array or non-strings", () => {
    const bad1 = filterSetSchema.safeParse({ match: MatchType.all, rules: [{ field: "camera", op: RuleOp.in_list, value: [] }] });
    const bad2 = filterSetSchema.safeParse({ match: MatchType.all, rules: [{ field: "camera", op: RuleOp.in_list, value: [1, 2] }] });
    expect(bad1.success).toBe(false);
    expect(bad2.success).toBe(false);
  });
});
```

- [ ] **Step 3: Run → fail.** `pnpm --filter @lumio/shared exec vitest run src/filters.test.ts` → FAIL.

- [ ] **Step 4: Implement.** In `packages/shared/src/filters.ts`:

  (a) Add a `STR_COL_OPS` array (string columns get in-list; generic JSON string fields do not) and use it for the string **column** fields. Replace the `STR_OPS` used by `cameraMake`/`cameraModel`/`lensModel` with `STR_COL_OPS`:

```ts
const STR_COL_OPS = [
  RuleOp.eq, RuleOp.ne, RuleOp.contains, RuleOp.in_list, RuleOp.not_in_list,
  RuleOp.exists, RuleOp.not_exists,
];
```
  Change the three entries: `cameraMake`, `cameraModel`, `lensModel` to use `ops: STR_COL_OPS` (leave `filename` on its `[contains, eq]`, `album` on its album ops, generic JSON on `GENERIC_JSON_OPS`).

  (b) In the `filterSetSchema` `superRefine` (the rule validator), handle the in-list ops like the album ops (require a non-empty `string[]`). Add `RuleOp.in_list`/`RuleOp.not_in_list` to the existing `ALBUM_OPS` check OR add a parallel set. Cleanest: rename the existing `ALBUM_OPS` concept usage by adding a `LIST_OPS` set used in the same branch:

```ts
const LIST_OPS = new Set<RuleOp>([RuleOp.in_album, RuleOp.not_in_album, RuleOp.in_list, RuleOp.not_in_list]);
```
  and change the album-op branch condition from `ALBUM_OPS.has(rule.op)` to `LIST_OPS.has(rule.op)`, and tighten it to also reject an empty array:

```ts
    if (LIST_OPS.has(rule.op)) {
      if (!Array.isArray(rule.value) || rule.value.length === 0 || rule.value.some((v) => typeof v !== "string")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "list op requires a non-empty string[]" });
      }
      return;
    }
```
  (Remove the now-unused `ALBUM_OPS` const if it's no longer referenced.)

- [ ] **Step 5: Run → pass.** `pnpm --filter @lumio/shared exec vitest run src/filters.test.ts` then `pnpm --filter @lumio/shared test` → green; `pnpm --filter @lumio/shared typecheck` → clean.

> Note: existing `filterSetSchema` album tests must still pass — `in_album` stays valid via `LIST_OPS`.

- [ ] **Step 6: Commit.**

```bash
git add packages/shared/src/enums.ts packages/shared/src/filters.ts packages/shared/src/filters.test.ts
git commit -m "feat(shared): in_list/not_in_list operator for multiselect (string columns)"
```

---

### Task 2: `buildPhotoWhere` column `in`/`notIn` compilation (db)

**Files:**
- Modify: `packages/db/src/photo-where.ts`
- Modify: `packages/db/src/photo-where.test.ts`

- [ ] **Step 1: Failing tests (append to `photo-where.test.ts`).**

```ts
  it("in_list on a string column → { in: [...] }", () => {
    expect(where([{ field: "camera", op: RuleOp.in_list, value: ["Sony", "Nikon"] }])).toEqual({
      AND: [{ cameraModel: { in: ["Sony", "Nikon"] } }],
    });
  });

  it("not_in_list on a string column → { notIn: [...] }", () => {
    expect(where([{ field: "lens", op: RuleOp.not_in_list, value: ["FE 50mm"] }])).toEqual({
      AND: [{ lensModel: { notIn: ["FE 50mm"] } }],
    });
  });
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @lumio/db exec vitest run src/photo-where.test.ts` → FAIL ("unsupported rule" for in_list).

- [ ] **Step 3: Implement.** In `columnClause` (in `packages/db/src/photo-where.ts`), add two cases to the `switch (rule.op)`:

```ts
    case RuleOp.in_list:
      return wrap({ in: rule.value });
    case RuleOp.not_in_list:
      return wrap({ notIn: rule.value });
```
(Place them before the `default`. `wrap` already builds `{ [col]: predicate }`.)

- [ ] **Step 4: Run → pass.** `pnpm --filter @lumio/db exec vitest run src/photo-where.test.ts`, `pnpm --filter @lumio/db test`, `pnpm --filter @lumio/db typecheck` → all green.

- [ ] **Step 5: Commit.**

```bash
git add packages/db/src/photo-where.ts packages/db/src/photo-where.test.ts
git commit -m "feat(db): compile in_list/not_in_list to Prisma in/notIn on columns"
```

---

### Task 3: `formatRuleLabel` for in-list (shared)

`ruleToToken`/`parseFilterTokens` do NOT need in-list support (chips serialize as JSON, not
tokens). Only the human chip label is needed.

**Files:**
- Modify: `packages/shared/src/filter-tokens.ts`
- Modify: `packages/shared/src/filter-tokens.test.ts`

- [ ] **Step 1: Failing test (append to the `formatRuleLabel` describe block).**

```ts
  it("labels in-list rules", () => {
    expect(formatRuleLabel({ field: "cameraModel", op: RuleOp.in_list, value: ["Sony", "Nikon"] })).toBe(
      "Camera is Sony or Nikon",
    );
    expect(formatRuleLabel({ field: "lensModel", op: RuleOp.not_in_list, value: ["FE 50mm"] })).toBe(
      "Lens is not FE 50mm",
    );
  });
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @lumio/shared exec vitest run src/filter-tokens.test.ts` → FAIL (falls to default "= [object Object]"-ish).

- [ ] **Step 3: Implement.** In `formatRuleLabel`'s switch, add cases before `default`:

```ts
    case RuleOp.in_list:
      return `${name} is ${(rule.value as string[]).join(" or ")}`;
    case RuleOp.not_in_list:
      return `${name} is not ${(rule.value as string[]).join(" or ")}`;
```

- [ ] **Step 4: Run → pass.** `pnpm --filter @lumio/shared exec vitest run src/filter-tokens.test.ts`, `pnpm --filter @lumio/shared test`, typecheck → green.

- [ ] **Step 5: Commit.**

```bash
git add packages/shared/src/filter-tokens.ts packages/shared/src/filter-tokens.test.ts
git commit -m "feat(shared): formatRuleLabel for in_list/not_in_list chips"
```

---

## Part B — Frontend pure logic + plumbing

### Task 4: `SearchFilters.match` + query plumbing

**Files:**
- Modify: `apps/web/src/app/(app)/search/filters.ts`
- Modify: `apps/web/src/app/(app)/search/filters.test.ts`

- [ ] **Step 1: Failing tests (append; import `MatchType` from `@lumio/shared`).** Also update existing `buildFilters` expectations to include `match: MatchType.all`, and any `SearchFilters` literal in existing tests to add `match: MatchType.all` (the new required field).

```ts
it("buildFilters defaults match to all", () => {
  expect(buildFilters([], "iso:>800").match).toBe(MatchType.all);
});

it("paramsFor emits the filter match (all omitted only if no rules)", () => {
  const p = paramsFor({ albums: [], q: "", rules: [{ field: "iso", op: RuleOp.gt, value: 800 }], match: MatchType.any });
  expect(JSON.parse(p.get("filter")!)).toEqual({ match: "any", rules: [{ field: "iso", op: RuleOp.gt, value: 800 }] });
});

it("serialize distinguishes match", () => {
  const base = { albums: [], q: "", rules: [{ field: "iso", op: RuleOp.gt, value: 800 }] };
  expect(serialize({ ...base, match: MatchType.all })).not.toBe(serialize({ ...base, match: MatchType.any }));
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @lumio/web exec vitest run "src/app/(app)/search/filters.test.ts"` → FAIL.

- [ ] **Step 3: Implement.** In `filters.ts`:
  - import `MatchType` from `@lumio/shared` (merge into the existing import).
  - add `match: MatchType;` to the `SearchFilters` interface.
  - `buildFilters`: return `match: MatchType.all` (typed tokens are always AND in v1; the panel sets `match`). Signature stays `(albums, rawText)`; add `match: MatchType.all` to the returned object.
  - `paramsFor`: use `{ match: filters.match, rules: filters.rules }` for the filter JSON (replace the hardcoded `MatchType.all`).
  - `serialize`: include `match` in the JSON: `{ albums: [...].sort(), q, rules, match: filters.match }`.

- [ ] **Step 4: Run → fail downstream tsc is EXPECTED.** `pnpm --filter @lumio/web exec vitest run "src/app/(app)/search/filters.test.ts"` → PASS. `pnpm --filter @lumio/web exec tsc --noEmit` will now error on `EMPTY`/`SearchFilters` literals in `search-view.tsx` and `recent-searches.tsx` (missing `match`) — fixed in Task 5. Report the error list; do NOT fix here.

- [ ] **Step 5: Commit.**

```bash
git add "apps/web/src/app/(app)/search/filters.ts" "apps/web/src/app/(app)/search/filters.test.ts"
git commit -m "feat(search): SearchFilters carries match; paramsFor/serialize use it"
```

---

### Task 5: Close the `match` cascade (search-view + recent-searches)

**Files:**
- Modify: `apps/web/src/app/(app)/search/search-view.tsx`
- Modify: `apps/web/src/app/(app)/search/recent-searches.tsx`

- [ ] **Step 1: search-view.tsx.** Import `MatchType` from `@lumio/shared`. Update `EMPTY`:

```tsx
const EMPTY: SearchFilters = { albums: [], q: "", rules: [], match: MatchType.all };
```
(`isEmptyFilters` is unchanged — `match` doesn't affect emptiness.)

- [ ] **Step 2: recent-searches.tsx.** Normalize a missing `match` in `loadRecentSearches` (older entries) by extending the normalization map:

```tsx
      .map((f) => ({
        ...f,
        rules: Array.isArray(f.rules) ? f.rules : [],
        match: f.match === MatchType.any ? MatchType.any : MatchType.all,
      }));
```
Import `MatchType` from `@lumio/shared`.

- [ ] **Step 3: Verify tsc clean + suite.** `pnpm --filter @lumio/web exec tsc --noEmit` → CLEAN. `pnpm --filter @lumio/web test` → green.

- [ ] **Step 4: Commit.**

```bash
git add "apps/web/src/app/(app)/search/search-view.tsx" "apps/web/src/app/(app)/search/recent-searches.tsx"
git commit -m "feat(search): carry match through EMPTY + recents normalization"
```

---

### Task 6: Pure panel↔rules mapping (`panel-rules.ts`)

The testable core of the panel: convert between a field's widget value and the rules array.

**Files:**
- Create: `apps/web/src/app/(app)/search/panel-rules.ts`
- Create: `apps/web/src/app/(app)/search/panel-rules.test.ts`

- [ ] **Step 1: Failing test.** `panel-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RuleOp } from "@lumio/shared";
import { readMultiselect, applyMultiselect, readRange, applyRange, readToggle, applyToggle } from "./panel-rules";

describe("multiselect mapping", () => {
  it("reads the selected values from an in_list rule", () => {
    expect(readMultiselect([{ field: "cameraModel", op: RuleOp.in_list, value: ["Sony", "Nikon"] }], "cameraModel")).toEqual(["Sony", "Nikon"]);
    expect(readMultiselect([], "cameraModel")).toEqual([]);
  });
  it("apply replaces that field's rule with an in_list; empty selection drops it", () => {
    const r1 = applyMultiselect([], "cameraModel", ["Sony"]);
    expect(r1).toEqual([{ field: "cameraModel", op: RuleOp.in_list, value: ["Sony"] }]);
    const r2 = applyMultiselect(r1, "cameraModel", ["Sony", "Nikon"]);
    expect(r2).toEqual([{ field: "cameraModel", op: RuleOp.in_list, value: ["Sony", "Nikon"] }]);
    expect(applyMultiselect(r2, "cameraModel", [])).toEqual([]);
  });
  it("apply leaves other fields untouched", () => {
    const start = [{ field: "iso", op: RuleOp.gt, value: 800 }];
    expect(applyMultiselect(start, "cameraModel", ["Sony"])).toEqual([
      { field: "iso", op: RuleOp.gt, value: 800 },
      { field: "cameraModel", op: RuleOp.in_list, value: ["Sony"] },
    ]);
  });
});

describe("range mapping", () => {
  it("reads {min,max} from gte/lte/between rules", () => {
    expect(readRange([{ field: "iso", op: RuleOp.between, value: [200, 1600] }], "iso")).toEqual({ min: 200, max: 1600 });
    expect(readRange([{ field: "iso", op: RuleOp.gte, value: 800 }], "iso")).toEqual({ min: 800, max: null });
    expect(readRange([], "iso")).toEqual({ min: null, max: null });
  });
  it("apply emits between/gte/lte and drops when both empty", () => {
    expect(applyRange([], "iso", { min: 200, max: 1600 })).toEqual([{ field: "iso", op: RuleOp.between, value: [200, 1600] }]);
    expect(applyRange([], "iso", { min: 800, max: null })).toEqual([{ field: "iso", op: RuleOp.gte, value: 800 }]);
    expect(applyRange([], "iso", { min: null, max: 100 })).toEqual([{ field: "iso", op: RuleOp.lte, value: 100 }]);
    expect(applyRange([{ field: "iso", op: RuleOp.gte, value: 1 }], "iso", { min: null, max: null })).toEqual([]);
  });
});

describe("toggle mapping", () => {
  it("reads + applies a boolean eq rule (hasGps)", () => {
    expect(readToggle([{ field: "hasGps", op: RuleOp.eq, value: true }], "hasGps")).toBe(true);
    expect(readToggle([], "hasGps")).toBe(false);
    expect(applyToggle([], "hasGps", true)).toEqual([{ field: "hasGps", op: RuleOp.eq, value: true }]);
    expect(applyToggle([{ field: "hasGps", op: RuleOp.eq, value: true }], "hasGps", false)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @lumio/web exec vitest run "src/app/(app)/search/panel-rules.test.ts"` → FAIL (module missing).

- [ ] **Step 3: Implement.** `panel-rules.ts`:

```ts
import { type FilterRule, RuleOp } from "@lumio/shared";

/** Drop every rule targeting `field`; returns a new array. */
function without(rules: FilterRule[], field: string): FilterRule[] {
  return rules.filter((r) => r.field !== field);
}

export function readMultiselect(rules: FilterRule[], field: string): string[] {
  const r = rules.find((x) => x.field === field && x.op === RuleOp.in_list);
  return Array.isArray(r?.value) ? (r.value as string[]) : [];
}

export function applyMultiselect(rules: FilterRule[], field: string, values: string[]): FilterRule[] {
  const rest = without(rules, field);
  if (values.length === 0) return rest;
  return [...rest, { field, op: RuleOp.in_list, value: values }];
}

export interface RangeValue {
  min: number | null;
  max: number | null;
}

export function readRange(rules: FilterRule[], field: string): RangeValue {
  const r = rules.find((x) => x.field === field);
  if (!r) return { min: null, max: null };
  if (r.op === RuleOp.between) {
    const [a, b] = r.value as [number, number];
    return { min: a, max: b };
  }
  if (r.op === RuleOp.gte || r.op === RuleOp.gt) return { min: r.value as number, max: null };
  if (r.op === RuleOp.lte || r.op === RuleOp.lt) return { min: null, max: r.value as number };
  return { min: null, max: null };
}

export function applyRange(rules: FilterRule[], field: string, { min, max }: RangeValue): FilterRule[] {
  const rest = without(rules, field);
  if (min !== null && max !== null) return [...rest, { field, op: RuleOp.between, value: [min, max] }];
  if (min !== null) return [...rest, { field, op: RuleOp.gte, value: min }];
  if (max !== null) return [...rest, { field, op: RuleOp.lte, value: max }];
  return rest;
}

export function readToggle(rules: FilterRule[], field: string): boolean {
  return rules.some((r) => r.field === field && r.op === RuleOp.eq && r.value === true);
}

export function applyToggle(rules: FilterRule[], field: string, on: boolean): FilterRule[] {
  const rest = without(rules, field);
  return on ? [...rest, { field, op: RuleOp.eq, value: true }] : rest;
}
```

> A date range reuses `readRange`/`applyRange` shape but with ISO-string values; the date
> widget (Task 11) supplies `{min,max}` as ISO strings and a `applyDateRange` variant is
> added there if the numeric typing gets in the way. Keep these numeric for now.

- [ ] **Step 4: Run → pass.** `pnpm --filter @lumio/web exec vitest run "src/app/(app)/search/panel-rules.test.ts"`, `pnpm --filter @lumio/web test`, tsc → green.

- [ ] **Step 5: Commit.**

```bash
git add "apps/web/src/app/(app)/search/panel-rules.ts" "apps/web/src/app/(app)/search/panel-rules.test.ts"
git commit -m "feat(search): pure panel↔rules mapping helpers"
```

---

### Task 7: EXIF discovery hooks (`use-exif-discovery.ts`)

**Files:**
- Create: `apps/web/src/app/(app)/search/use-exif-discovery.ts`
- Create: `apps/web/src/app/(app)/search/use-exif-discovery.test.ts`

The pure normalizers are unit-tested; the hooks themselves are thin.

- [ ] **Step 1: Failing test.** `use-exif-discovery.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeValues, normalizeFields } from "./use-exif-discovery";

describe("discovery normalizers", () => {
  it("normalizeValues keeps {value,count} and tolerates junk", () => {
    expect(normalizeValues({ values: [{ value: "Sony", count: 5 }, { value: "Nikon", count: 2 }] })).toEqual([
      { value: "Sony", count: 5 }, { value: "Nikon", count: 2 },
    ]);
    expect(normalizeValues(null)).toEqual([]);
    expect(normalizeValues({})).toEqual([]);
  });
  it("normalizeFields returns the string list or []", () => {
    expect(normalizeFields({ fields: ["Make", "ISO"] })).toEqual(["Make", "ISO"]);
    expect(normalizeFields(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @lumio/web exec vitest run "src/app/(app)/search/use-exif-discovery.test.ts"` → FAIL.

- [ ] **Step 3: Implement.** `use-exif-discovery.ts`:

```ts
"use client";

import { useEffect, useState } from "react";

export interface ValueCount {
  value: string;
  count: number;
}

export function normalizeValues(data: unknown): ValueCount[] {
  const arr = (data as { values?: unknown })?.values;
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (v): v is ValueCount => !!v && typeof (v as ValueCount).value === "string" && typeof (v as ValueCount).count === "number",
  );
}

export function normalizeFields(data: unknown): string[] {
  const arr = (data as { fields?: unknown })?.fields;
  return Array.isArray(arr) ? arr.filter((f): f is string => typeof f === "string") : [];
}

/** Distinct values (+counts) for a field, loaded once per field key. [] until loaded/on error. */
export function useExifValues(field: string | null): ValueCount[] {
  const [values, setValues] = useState<ValueCount[]>([]);
  useEffect(() => {
    if (!field) {
      setValues([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/exif/values?field=${encodeURIComponent(field)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setValues(normalizeValues(d)))
      .catch(() => !cancelled && setValues([]));
    return () => {
      cancelled = true;
    };
  }, [field]);
  return values;
}

/** Distinct EXIF keys present in the library, loaded once. */
export function useExifFields(enabled: boolean): string[] {
  const [fields, setFields] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/exif/fields")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setFields(normalizeFields(d)))
      .catch(() => !cancelled && setFields([]));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return fields;
}
```

- [ ] **Step 4: Run → pass.** vitest on the test file + `pnpm --filter @lumio/web test` + tsc → green.

- [ ] **Step 5: Commit.**

```bash
git add "apps/web/src/app/(app)/search/use-exif-discovery.ts" "apps/web/src/app/(app)/search/use-exif-discovery.test.ts"
git commit -m "feat(search): EXIF discovery hooks (fields/values) + normalizers"
```

---

### Task 8: Add the shadcn `checkbox` component

**Files:**
- Create: `apps/web/src/components/ui/checkbox.tsx`

- [ ] **Step 1: Add via the shadcn MCP.** Use the shadcn MCP tools to fetch the Base-UI-compatible `checkbox` component for this project's registry (the project uses Base UI per `components/ui/*`). If the MCP add writes the file, verify it lands at `apps/web/src/components/ui/checkbox.tsx` and imports match the existing `ui/*` style (e.g. `cn` from `@/lib/utils`). If the registry's checkbox depends on a package not installed, install it (`pnpm --filter @lumio/web add <pkg>`).

- [ ] **Step 2: Typecheck.** `pnpm --filter @lumio/web exec tsc --noEmit` → clean.

- [ ] **Step 3: Commit.**

```bash
git add apps/web/src/components/ui/checkbox.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "chore(web): add shadcn checkbox component"
```

> If the MCP can't resolve a Base-UI checkbox, fall back to a minimal local checkbox
> (a styled `<input type="checkbox">` wrapper) in the same file — report which path you took.

---

## Part C — Search-box chips (the A-model)

### Task 9: EXIF chips in the box — render, read, remove

This is the architectural heart. EXIF rules become chips carrying `data-rule` (JSON);
`readEditor` merges chip rules with parsed free text; `applyFilters` re-renders the box
from a `SearchFilters`. Pure rule-merging is extracted + unit-tested; DOM glue is verified
by tsc + browser.

**Files:**
- Modify: `apps/web/src/app/(app)/search/search-input.tsx`
- Create: `apps/web/src/app/(app)/search/editor-rules.ts`
- Create: `apps/web/src/app/(app)/search/editor-rules.test.ts`

- [ ] **Step 1: Failing test for the pure merge helper.** `editor-rules.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RuleOp } from "@lumio/shared";
import { mergeEditorRules } from "./editor-rules";

describe("mergeEditorRules", () => {
  it("combines chip rules with rules parsed from free text; q is the leftover", () => {
    const out = mergeEditorRules(
      [{ field: "cameraModel", op: RuleOp.in_list, value: ["Sony"] }],
      "iso:>800 beach",
    );
    expect(out.rules).toEqual([
      { field: "cameraModel", op: RuleOp.in_list, value: ["Sony"] },
      { field: "iso", op: RuleOp.gt, value: 800 },
    ]);
    expect(out.q).toBe("beach");
  });
  it("no chips, no tokens → empty rules, q is the text", () => {
    expect(mergeEditorRules([], "sunset")).toEqual({ rules: [], q: "sunset" });
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @lumio/web exec vitest run "src/app/(app)/search/editor-rules.test.ts"` → FAIL.

- [ ] **Step 3: Implement the merge helper.** `editor-rules.ts`:

```ts
import { type FilterRule, parseFilterTokens } from "@lumio/shared";

/** Combine the rules carried by EXIF chips with the rules parsed from the box's free
 *  text. Chip rules come first (panel/committed), then typed-but-unchipped tokens. */
export function mergeEditorRules(chipRules: FilterRule[], freeText: string): { rules: FilterRule[]; q: string } {
  const parsed = parseFilterTokens(freeText);
  return { rules: [...chipRules, ...parsed.rules], q: parsed.text };
}
```

- [ ] **Step 4: Run → pass.** vitest on the file → PASS.

- [ ] **Step 5: Wire chips into `search-input.tsx`.** Read the file first. Make these changes:

  (a) Imports: add `import { type FilterRule, formatRuleLabel } from "@lumio/shared";` and `import { mergeEditorRules } from "./editor-rules";`. (Drop the now-unused `ruleToToken` import if present — applyFilters no longer needs it.)

  (b) Add an EXIF chip renderer mirroring `chipHtml` but storing the rule as JSON:

```tsx
function exifChipHtml(rule: FilterRule): string {
  const json = escapeHtml(JSON.stringify(rule));
  const label = escapeHtml(formatRuleLabel(rule));
  return (
    `<span contenteditable="false" data-facet="exif" data-rule="${json}" ` +
    `class="mx-0.5 inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 align-middle text-sm text-foreground">` +
    `${label}` +
    `<button type="button" data-chip-remove tabindex="-1" class="ml-0.5 leading-none text-muted-foreground hover:text-foreground">×</button>` +
    `</span>&nbsp;`
  );
}
```

  (c) `readEditor`: collect EXIF chip rules from `[data-facet="exif"]` `data-rule` JSON, keep collecting album chips and free text as today, and return via `mergeEditorRules`:

```tsx
function readEditor(el: HTMLElement): SearchFilters {
  const albums: string[] = [];
  el.querySelectorAll<HTMLElement>('[data-facet="album"]').forEach((chip) => {
    const value = chip.getAttribute("data-value");
    if (value) albums.push(value);
  });

  const chipRules: FilterRule[] = [];
  el.querySelectorAll<HTMLElement>('[data-facet="exif"]').forEach((chip) => {
    const raw = chip.getAttribute("data-rule");
    if (!raw) return;
    try {
      chipRules.push(JSON.parse(raw) as FilterRule);
    } catch {
      /* ignore a corrupt chip */
    }
  });

  let rawText = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (!node.parentElement?.closest("[data-facet]")) rawText += node.textContent ?? "";
    node = walker.nextNode();
  }
  const { rules, q } = mergeEditorRules(chipRules, rawText.replace(/ /g, " ").trim());
  return { albums: Array.from(new Set(albums)), q, rules, match: MatchETC };
}
```
  IMPORTANT: `match` must be preserved across reads. `readEditor` doesn't know the current
  `match` (the box doesn't store it). Resolve this by having the box NOT own `match`: keep
  `match` in `SearchView` state, and have `onChange` from the box merge the box's
  `{albums,q,rules}` with the SearchView-held `match`. Concretely: change `readEditor` to
  return `Omit<SearchFilters, "match">` and update `emitNow`/`emitDebounced`/`handleBlur`/
  the Tribute callbacks to call `onChange(readEditor(el))` where `onChange` is typed to
  accept the box's partial; `SearchView` re-attaches `match`. (See Task 10 for the SearchView
  side.) Replace `match: MatchETC` above by returning the partial without `match`.

  (d) `isEditorEmpty` already checks `[data-facet]` — EXIF chips count, no change.

  (e) `applyFilters` (imperative handle): render album chips, then EXIF chips (one per
  rule), then the free text `q`:

```tsx
      applyFilters(filters: Omit<SearchFilters, "match">) {
        const el = editorRef.current;
        if (!el) return;
        void loadAllOptions()
          .catch(() => [] as TributeFacetItem[])
          .then((opts) => {
            const labelFor = (id: string) =>
              opts.find((o) => o.facetKey === "album" && o.value === id)?.label ?? id;
            el.innerHTML =
              filters.albums
                .map((id) => chipHtml({ facetKey: "album", facetLabel: "Album", value: id, label: labelFor(id) }))
                .join("") + filters.rules.map(exifChipHtml).join("");
            if (filters.q) el.appendChild(document.createTextNode(filters.q));
            el.focus();
            emitNow();
          });
      },
```

  (f) Blur-canonicalize (optional but recommended): in `handleBlur`, after `onCommit`, if
  the box has typed-but-unchipped tokens, rebuild as chips. Skip if blurring to the Tribute
  menu. Minimal version — call the imperative `applyFilters(readEditor(el))` only when
  `readEditor(el).rules` has entries that aren't already chips. Keep it simple: defer this
  if it proves fiddly; the panel canonicalizes on its own changes. Note what you did.

  The chip-removal handlers (`handleClick` on `[data-chip-remove]`, Backspace via
  `adjacentChip`) already operate on any `[data-facet]` element, so EXIF chips are removable
  with no change.

- [ ] **Step 6: Update the `SearchInputHandle` + `onChange` types.** `SearchInputHandle.applyFilters` now takes `Omit<SearchFilters, "match">`; `onChange` prop type becomes `(filters: Omit<SearchFilters, "match">) => void`. (SearchView re-attaches match — Task 10.)

- [ ] **Step 7: Typecheck.** `pnpm --filter @lumio/web exec tsc --noEmit` — expect errors ONLY in `search-view.tsx` (the `onChange`/`applyFilters`/`match` wiring), fixed in Task 10. Report them.

- [ ] **Step 8: Commit.**

```bash
git add "apps/web/src/app/(app)/search/search-input.tsx" "apps/web/src/app/(app)/search/editor-rules.ts" "apps/web/src/app/(app)/search/editor-rules.test.ts"
git commit -m "feat(search): EXIF rules as removable JSON chips in the search box"
```

---

## Part D — The panel

### Task 10: SearchView wiring + panel shell + Filters button + match toggle

**Files:**
- Modify: `apps/web/src/app/(app)/search/search-view.tsx`
- Create: `apps/web/src/app/(app)/search/filter-panel.tsx`

- [ ] **Step 1: SearchView owns `match`; re-attach it to box reads.** In `search-view.tsx`:
  - Keep `filters` state as a full `SearchFilters`. Change the `SearchInput`'s `onChange` handler to merge in the current `match`:

```tsx
            onChange={(partial) => setFilters((prev) => ({ ...partial, match: prev.match }))}
```
  - `applyRecent` / `handleCommit` pass `Omit<SearchFilters,"match">` to `inputRef.applyFilters` — drop `match` when calling: `inputRef.current?.applyFilters({ albums: f.albums, q: f.q, rules: f.rules })`.
  - Add a panel-driven setter used by the panel:

```tsx
  function applyPanel(next: SearchFilters) {
    setFilters(next);
    inputRef.current?.applyFilters({ albums: next.albums, q: next.q, rules: next.rules });
  }
```

- [ ] **Step 2: Add the Filters button + panel** in the toolbar's non-select branch, next to `GridSortMenu`:

```tsx
                      <FilterPanel filters={filters} onChange={applyPanel} />
```

- [ ] **Step 3: Implement `filter-panel.tsx` shell.** A popover with a trigger button and an inner scroll area; the match toggle lives at the top. Use the existing `Popover` (`@/components/ui/popover`), `Button`, `Switch`. Widgets are added in Tasks 11–14; for now render the match toggle + an empty container.

```tsx
"use client";

import { SlidersHorizontal } from "lucide-react";
import { MatchType } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { SearchFilters } from "./filters";

export function FilterPanel({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
  const activeCount = filters.rules.length;
  return (
    <Popover>
      <PopoverTrigger render={
        <Button variant="outline" size="sm">
          <SlidersHorizontal aria-hidden />
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      } />
      <PopoverContent className="w-80 max-h-[70vh] overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">Filters</span>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Match any
            <Switch
              checked={filters.match === MatchType.any}
              onCheckedChange={(any: boolean) =>
                onChange({ ...filters, match: any ? MatchType.any : MatchType.all })
              }
            />
          </label>
        </div>
        <div className="flex flex-col gap-4">
          {/* widget sections added in Tasks 11–14 */}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```
  Confirm the actual `Popover`/`Switch` prop API by reading `components/ui/popover.tsx` and
  `components/ui/switch.tsx` (Base UI's `render` prop + `onCheckedChange` may differ — match
  the existing usages, e.g. in `new-album-dialog.tsx`).

- [ ] **Step 4: Typecheck + suite.** `pnpm --filter @lumio/web exec tsc --noEmit` → CLEAN. `pnpm --filter @lumio/web test` → green.

- [ ] **Step 5: Commit.**

```bash
git add "apps/web/src/app/(app)/search/search-view.tsx" "apps/web/src/app/(app)/search/filter-panel.tsx"
git commit -m "feat(search): filter panel shell + toolbar button + match toggle"
```

---

### Task 11: Multiselect widget (camera, lens)

**Files:**
- Create: `apps/web/src/app/(app)/search/facet-multiselect.tsx`
- Modify: `apps/web/src/app/(app)/search/filter-panel.tsx`

- [ ] **Step 1: Implement `facet-multiselect.tsx`.** A labelled section: a search input filtering a scrollable checkbox list of `value (count)` from `useExifValues`, selected state from `readMultiselect`, changes via `applyMultiselect`.

```tsx
"use client";

import { useMemo, useState } from "react";
import type { FilterRule } from "@lumio/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useExifValues } from "./use-exif-discovery";
import { applyMultiselect, readMultiselect } from "./panel-rules";

export function FacetMultiselect({
  label,
  field,
  fieldKey,
  rules,
  onRules,
}: {
  label: string;
  field: string; // discovery field name (e.g. "camera")
  fieldKey: string; // canonical rule field key (e.g. "cameraModel")
  rules: FilterRule[];
  onRules: (next: FilterRule[]) => void;
}) {
  const values = useExifValues(field);
  const [query, setQuery] = useState("");
  const selected = readMultiselect(rules, fieldKey);
  const shown = useMemo(
    () => values.filter((v) => v.value.toLowerCase().includes(query.toLowerCase())),
    [values, query],
  );
  function toggle(value: string, on: boolean) {
    const next = on ? [...selected, value] : selected.filter((v) => v !== value);
    onRules(applyMultiselect(rules, fieldKey, next));
  }
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Filter ${label.toLowerCase()}…`} className="mb-2 h-8" />
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {shown.map((v) => (
          <label key={v.value} className="flex items-center gap-2 text-sm">
            <Checkbox checked={selected.includes(v.value)} onCheckedChange={(on: boolean) => toggle(v.value, on)} />
            <span className="flex-1 truncate">{v.value}</span>
            <span className="text-xs text-muted-foreground">{v.count.toLocaleString()}</span>
          </label>
        ))}
        {shown.length === 0 && <span className="text-xs text-muted-foreground">No values</span>}
      </div>
    </section>
  );
}
```
  Match the real `Checkbox` API (Task 8) — `checked`/`onCheckedChange` may differ; read the
  generated file.

- [ ] **Step 2: Mount in the panel.** In `filter-panel.tsx`, inside the widget container, add (passing a per-field `onRules` that rebuilds `SearchFilters`):

```tsx
          <FacetMultiselect label="Camera" field="camera" fieldKey="cameraModel" rules={filters.rules} onRules={setRules} />
          <FacetMultiselect label="Lens" field="lens" fieldKey="lensModel" rules={filters.rules} onRules={setRules} />
```
  where `setRules` is a local helper in `FilterPanel`:

```tsx
  const setRules = (rules: typeof filters.rules) => onChange({ ...filters, rules });
```

- [ ] **Step 3: Typecheck + browser-verify** the camera/lens lists populate with counts and selecting adds an in-list chip. `pnpm --filter @lumio/web exec tsc --noEmit` clean; `pnpm --filter @lumio/web test` green.

- [ ] **Step 4: Commit.**

```bash
git add "apps/web/src/app/(app)/search/facet-multiselect.tsx" "apps/web/src/app/(app)/search/filter-panel.tsx"
git commit -m "feat(search): camera/lens multiselect facet with counts"
```

---

### Task 12: Numeric range widgets (ISO, aperture, focal length)

**Files:**
- Create: `apps/web/src/app/(app)/search/facet-range.tsx`
- Modify: `apps/web/src/app/(app)/search/filter-panel.tsx`

- [ ] **Step 1: Implement `facet-range.tsx`.** Min/max number inputs bound to `readRange`/`applyRange`.

```tsx
"use client";

import type { FilterRule } from "@lumio/shared";
import { Input } from "@/components/ui/input";
import { applyRange, readRange } from "./panel-rules";

export function FacetRange({
  label,
  fieldKey,
  step,
  rules,
  onRules,
}: {
  label: string;
  fieldKey: string;
  step?: string;
  rules: FilterRule[];
  onRules: (next: FilterRule[]) => void;
}) {
  const { min, max } = readRange(rules, fieldKey);
  function set(side: "min" | "max", raw: string) {
    const num = raw === "" ? null : Number(raw);
    const value = num !== null && Number.isFinite(num) ? num : null;
    const nextRange = side === "min" ? { min: value, max } : { min, max: value };
    onRules(applyRange(rules, fieldKey, nextRange));
  }
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="flex items-center gap-2">
        <Input type="number" inputMode="decimal" step={step} value={min ?? ""} onChange={(e) => set("min", e.target.value)} placeholder="min" className="h-8" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="number" inputMode="decimal" step={step} value={max ?? ""} onChange={(e) => set("max", e.target.value)} placeholder="max" className="h-8" />
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Mount in the panel.**

```tsx
          <FacetRange label="ISO" fieldKey="iso" rules={filters.rules} onRules={setRules} />
          <FacetRange label="Aperture" fieldKey="aperture" step="0.1" rules={filters.rules} onRules={setRules} />
          <FacetRange label="Focal length (mm)" fieldKey="focalLength" rules={filters.rules} onRules={setRules} />
```
  Note `aperture` is the canonical registry key (column `fNumber`); `readRange`/`applyRange`
  key on the rule's `field`, which for panel-created rules is `aperture` — consistent with
  the registry key, and `buildPhotoWhere`/`resolveField` map `aperture`→`fNumber`. Confirm
  `paramsFor`'s JSON uses `field:"aperture"` and the backend resolves it (it does, via
  `resolveField`).

- [ ] **Step 3: Typecheck + suite + browser-verify** a range adds a `between`/`gte`/`lte` chip and filters.

- [ ] **Step 4: Commit.**

```bash
git add "apps/web/src/app/(app)/search/facet-range.tsx" "apps/web/src/app/(app)/search/filter-panel.tsx"
git commit -m "feat(search): ISO/aperture/focal numeric range facets"
```

---

### Task 13: Date range facet

**Files:**
- Modify: `apps/web/src/app/(app)/search/panel-rules.ts` (+test) — add date variants
- Create: `apps/web/src/app/(app)/search/facet-date.tsx`
- Modify: `apps/web/src/app/(app)/search/filter-panel.tsx`

- [ ] **Step 1: Failing test for date mapping (append to `panel-rules.test.ts`).**

```ts
describe("date range mapping", () => {
  it("reads ISO from/to and applies between/gte/lte", () => {
    expect(readDateRange([{ field: "takenAt", op: RuleOp.between, value: ["2024-01-01", "2024-12-31"] }])).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    expect(applyDateRange([], { from: "2024-01-01", to: "" })).toEqual([{ field: "takenAt", op: RuleOp.gte, value: "2024-01-01" }]);
    expect(applyDateRange([], { from: "", to: "2024-12-31" })).toEqual([{ field: "takenAt", op: RuleOp.lte, value: "2024-12-31" }]);
    expect(applyDateRange([{ field: "takenAt", op: RuleOp.gte, value: "x" }], { from: "", to: "" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Implement in `panel-rules.ts`.**

```ts
export interface DateRangeValue {
  from: string;
  to: string;
}

export function readDateRange(rules: FilterRule[]): DateRangeValue {
  const r = rules.find((x) => x.field === "takenAt");
  if (!r) return { from: "", to: "" };
  if (r.op === RuleOp.between) {
    const [a, b] = r.value as [string, string];
    return { from: a, to: b };
  }
  if (r.op === RuleOp.gte || r.op === RuleOp.gt) return { from: r.value as string, to: "" };
  if (r.op === RuleOp.lte || r.op === RuleOp.lt) return { from: "", to: r.value as string };
  return { from: "", to: "" };
}

export function applyDateRange(rules: FilterRule[], { from, to }: DateRangeValue): FilterRule[] {
  const rest = rules.filter((r) => r.field !== "takenAt");
  if (from && to) return [...rest, { field: "takenAt", op: RuleOp.between, value: [from, to] }];
  if (from) return [...rest, { field: "takenAt", op: RuleOp.gte, value: from }];
  if (to) return [...rest, { field: "takenAt", op: RuleOp.lte, value: to }];
  return rest;
}
```
  (Import nothing new — `FilterRule`/`RuleOp` already imported. Add `readDateRange`/`applyDateRange`
  to the test import.)

- [ ] **Step 3: Run → pass** the panel-rules tests.

- [ ] **Step 4: Implement `facet-date.tsx`** with two native date inputs:

```tsx
"use client";

import type { FilterRule } from "@lumio/shared";
import { Input } from "@/components/ui/input";
import { applyDateRange, readDateRange } from "./panel-rules";

export function FacetDate({ rules, onRules }: { rules: FilterRule[]; onRules: (next: FilterRule[]) => void }) {
  const { from, to } = readDateRange(rules);
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Date taken</h3>
      <div className="flex items-center gap-2">
        <Input type="date" value={from} onChange={(e) => onRules(applyDateRange(rules, { from: e.target.value, to }))} className="h-8" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={to} onChange={(e) => onRules(applyDateRange(rules, { from, to: e.target.value }))} className="h-8" />
      </div>
    </section>
  );
}
```
  Note: native `<input type=date>` yields `YYYY-MM-DD`; the backend's date coercion (Phase 2a)
  / Prisma accepts these ISO-date strings on the `takenAt` column.

- [ ] **Step 5: Mount in the panel.** `<FacetDate rules={filters.rules} onRules={setRules} />`.

- [ ] **Step 6: Typecheck + suite + browser-verify.** Commit.

```bash
git add "apps/web/src/app/(app)/search/panel-rules.ts" "apps/web/src/app/(app)/search/panel-rules.test.ts" "apps/web/src/app/(app)/search/facet-date.tsx" "apps/web/src/app/(app)/search/filter-panel.tsx"
git commit -m "feat(search): date-range facet"
```

---

### Task 14: Toggles (has-location, orientation)

**Files:**
- Modify: `apps/web/src/app/(app)/search/panel-rules.ts` (+test) — orientation helper
- Create: `apps/web/src/app/(app)/search/facet-toggles.tsx`
- Modify: `apps/web/src/app/(app)/search/filter-panel.tsx`

- [ ] **Step 1: Orientation mapping decision + test.** EXIF `orientation` is a JSONB number
  (1–8). Portrait = values `{5,6,7,8}` (90°/270° rotations), landscape = `{1,2,3,4}`. Model
  the orientation filter as an `in_list`-style set on the JSON field is NOT supported (in_list
  is column-only). So instead use a simpler representation: a **3-state** select
  (Any | Portrait | Landscape) that maps to NO rule / `orientation gte 5` (portrait) /
  `orientation lt 5` (landscape) — using the numeric ordering of the EXIF enum where 5–8 are
  the rotated set. (`orientation`'s registry ops currently are `[eq, ne]` — add `gte`/`lt` to
  `orientation` ops in `filters.ts` for this; one-line registry change + a schema is already
  permissive for numeric json.) Append to `panel-rules.test.ts`:

```ts
describe("orientation mapping", () => {
  it("maps portrait/landscape/any to orientation rules", () => {
    expect(applyOrientation([], "portrait")).toEqual([{ field: "orientation", op: RuleOp.gte, value: 5 }]);
    expect(applyOrientation([], "landscape")).toEqual([{ field: "orientation", op: RuleOp.lt, value: 5 }]);
    expect(applyOrientation([{ field: "orientation", op: RuleOp.gte, value: 5 }], "any")).toEqual([]);
    expect(readOrientation([{ field: "orientation", op: RuleOp.lt, value: 5 }])).toBe("landscape");
    expect(readOrientation([])).toBe("any");
  });
});
```

- [ ] **Step 2: Add `gte`/`lt` to `orientation` ops** in `packages/shared/src/filters.ts`:
  change orientation's `ops` to `[RuleOp.eq, RuleOp.ne, RuleOp.gte, RuleOp.lt]`. (Run the shared
  test to confirm nothing breaks, then commit that with this task's frontend changes.)

- [ ] **Step 3: Implement orientation helpers in `panel-rules.ts`.**

```ts
export type Orientation = "any" | "portrait" | "landscape";

export function readOrientation(rules: FilterRule[]): Orientation {
  const r = rules.find((x) => x.field === "orientation");
  if (r?.op === RuleOp.gte && r.value === 5) return "portrait";
  if (r?.op === RuleOp.lt && r.value === 5) return "landscape";
  return "any";
}

export function applyOrientation(rules: FilterRule[], o: Orientation): FilterRule[] {
  const rest = rules.filter((r) => r.field !== "orientation");
  if (o === "portrait") return [...rest, { field: "orientation", op: RuleOp.gte, value: 5 }];
  if (o === "landscape") return [...rest, { field: "orientation", op: RuleOp.lt, value: 5 }];
  return rest;
}
```

- [ ] **Step 4: Run → pass** panel-rules tests + shared tests.

- [ ] **Step 5: Implement `facet-toggles.tsx`** (has-location switch + orientation segmented buttons) using `readToggle`/`applyToggle` and `readOrientation`/`applyOrientation`. Use `Switch` for has-location and three `Button`s (Any/Portrait/Landscape, the active one `variant="default"`) for orientation.

```tsx
"use client";

import type { FilterRule } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { type Orientation, applyOrientation, applyToggle, readOrientation, readToggle } from "./panel-rules";

const ORIENTATIONS: Orientation[] = ["any", "portrait", "landscape"];

export function FacetToggles({ rules, onRules }: { rules: FilterRule[]; onRules: (next: FilterRule[]) => void }) {
  const hasGps = readToggle(rules, "hasGps");
  const orientation = readOrientation(rules);
  return (
    <section className="flex flex-col gap-3">
      <label className="flex items-center justify-between text-sm">
        Has location
        <Switch checked={hasGps} onCheckedChange={(on: boolean) => onRules(applyToggle(rules, "hasGps", on))} />
      </label>
      <div>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Orientation</h3>
        <div className="flex gap-1">
          {ORIENTATIONS.map((o) => (
            <Button key={o} size="sm" variant={orientation === o ? "default" : "outline"} onClick={() => onRules(applyOrientation(rules, o))} className="capitalize">
              {o}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Mount in the panel** + typecheck + browser-verify + commit.

```bash
git add "apps/web/src/app/(app)/search/panel-rules.ts" "apps/web/src/app/(app)/search/panel-rules.test.ts" "apps/web/src/app/(app)/search/facet-toggles.tsx" "apps/web/src/app/(app)/search/filter-panel.tsx" packages/shared/src/filters.ts
git commit -m "feat(search): has-location + orientation facets"
```

---

### Task 15: Generic "＋ Add filter" row

**Files:**
- Create: `apps/web/src/app/(app)/search/facet-generic.tsx`
- Modify: `apps/web/src/app/(app)/search/filter-panel.tsx`

- [ ] **Step 1: Implement `facet-generic.tsx`.** A collapsible row: a field `<select>` (curated
  registry keys + discovered EXIF keys from `useExifFields`), an op `<select>` (the resolved
  field's valid ops, via `resolveField(field).ops`), and a value `<input>` (hidden for
  exists/not_exists). On "Add", append the rule. Use plain `<select>`/`Input` (the existing
  `new-album-dialog.tsx` uses plain `<select>` — match that pattern).

```tsx
"use client";

import { useState } from "react";
import { type FilterRule, FieldType, RuleOp, resolveField } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useExifFields } from "./use-exif-discovery";

const CURATED = ["cameraModel", "lensModel", "iso", "aperture", "focalLength", "exposureTime", "takenAt", "hasGps"];
const NO_VALUE = new Set<RuleOp>([RuleOp.exists, RuleOp.not_exists]);

export function FacetGeneric({ rules, onRules }: { rules: FilterRule[]; onRules: (next: FilterRule[]) => void }) {
  const fields = useExifFields(true);
  const options = Array.from(new Set([...CURATED, ...fields.map((f) => `exif.${f}`)]));
  const [field, setField] = useState(options[0] ?? "cameraModel");
  const def = resolveField(field);
  const [op, setOp] = useState<RuleOp>(def.ops[0]!);
  const [value, setValue] = useState("");

  function add() {
    let v: FilterRule["value"];
    if (NO_VALUE.has(op)) v = undefined;
    else if (def.type === FieldType.number) {
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      v = n;
    } else v = value;
    const rule: FilterRule = NO_VALUE.has(op) ? { field, op } : { field, op, value: v };
    onRules([...rules, rule]);
    setValue("");
  }

  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Add filter</h3>
      <div className="flex flex-col gap-2">
        <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={field} onChange={(e) => { setField(e.target.value); setOp(resolveField(e.target.value).ops[0]!); }}>
          {options.map((f) => <option key={f} value={f}>{resolveField(f).label}</option>)}
        </select>
        <div className="flex gap-2">
          <select className="h-8 rounded-md border border-input bg-transparent px-2 text-sm" value={op} onChange={(e) => setOp(e.target.value as RuleOp)}>
            {def.ops.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {!NO_VALUE.has(op) && <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" className="h-8 flex-1" />}
          <Button size="sm" onClick={add}>Add</Button>
        </div>
      </div>
    </section>
  );
}
```
  (in_list/not_in_list appear in the op list for camera/lens but the generic value input is a
  single string; for v1 the generic row treats them as a single-value list — acceptable, or
  filter them out of the generic op list with `def.ops.filter(o => o !== RuleOp.in_list && o !== RuleOp.not_in_list)`.
  Prefer filtering them out so the generic row only offers single-value ops.)

- [ ] **Step 2: Mount in the panel** (below the curated sections) + typecheck + browser-verify.

- [ ] **Step 3: Commit.**

```bash
git add "apps/web/src/app/(app)/search/facet-generic.tsx" "apps/web/src/app/(app)/search/filter-panel.tsx"
git commit -m "feat(search): generic add-filter row for any EXIF field"
```

---

### Task 16: Drop the 2a read-only chip row + final verification

**Files:**
- Modify: `apps/web/src/app/(app)/search/search-view.tsx`

- [ ] **Step 1: Remove the read-only chip row** that 2a rendered below `<SearchInput/>` (the
  `{filters.rules.length > 0 && (<div className="mt-2 …">…formatRuleLabel…</div>)}` block) —
  rules now render as removable chips *inside* the box. Leave the recents rule-chip rendering
  in `recent-searches.tsx` (that's a separate, still-useful display).

- [ ] **Step 2: Full suite + typecheck + lint.**
  - `pnpm -r test` → all green.
  - `pnpm --filter @lumio/web exec tsc --noEmit` → clean.
  - `pnpm --filter @lumio/web lint` → only the 2 known pre-existing errors (`use-activity.ts`, `use-async-job.ts`); 2b files clean.

- [ ] **Step 3: Browser smoke (manual / Claude-in-Chrome).** With dev server + a session, on `/search`:
  - Open Filters → pick two cameras (counts shown) → grid filters; two-camera shows as one "Camera is A or B" chip in the box.
  - Set ISO min 800 → "ISO ≥ 800" chip; date range; toggle Has location + Orientation portrait.
  - Toggle Match any → results widen; the `/api/search` request's `filter` JSON shows `match:"any"`.
  - Type `lens:?` in the box → becomes a chip; remove a chip with × → grid updates.
  - Add a generic `exif.<Key>` filter.
  - If browser is login-blocked, record it and rely on the unit coverage + a final code review (matching prior phases).

- [ ] **Step 4: Commit (if lint autofixes).**

```bash
git add -A && git commit -m "chore: exif-search 2b — drop 2a read-only chip row; suite green" || echo "nothing to commit"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** `in`/`not_in` operator (Tasks 1–3) ✓; `match` plumbing (Tasks 4–5) ✓;
  pure panel↔rules mapping (Tasks 6, 13, 14) ✓; discovery hooks (Task 7) ✓; checkbox primitive
  (Task 8) ✓; in-box removable chips A-model (Task 9) ✓; panel shell + match toggle (Task 10) ✓;
  multiselect (11), ranges (12), date (13), toggles (14), generic add-filter (15) ✓; remove 2a
  read-only row (16) ✓. **Deferred per spec:** place-name GPS, save-as-smart-album (Phase 3),
  calendar/slider, typed in-list grammar.
- **Type consistency:** `SearchFilters` gains `match` (Task 4) and every consumer is updated
  (Tasks 5, 9, 10); `SearchInputHandle.applyFilters`/`onChange` take `Omit<SearchFilters,"match">`
  (Task 9) and SearchView re-attaches `match` (Task 10); `RuleOp.in_list`/`not_in_list`,
  `readMultiselect`/`applyMultiselect`/`readRange`/`applyRange`/`readToggle`/`applyToggle`/
  `readDateRange`/`applyDateRange`/`readOrientation`/`applyOrientation`, `mergeEditorRules`,
  `normalizeValues`/`normalizeFields`, `FacetMultiselect`/`FacetRange`/`FacetDate`/`FacetToggles`/
  `FacetGeneric` names are stable across tasks.
- **Risk notes:** Task 9 (contenteditable chips) and the Base-UI `Popover`/`Switch`/`Checkbox`
  prop APIs are the implementation risks — each task says to read the existing `ui/*` file /
  `new-album-dialog.tsx` usage and match it. UI tasks are browser-verified.

## Follow-on (Phase 3 — separate plan)

Reuse the facet widgets in the smart-album rule-builder; swap `createAlbumSchema` to
`filterSetSchema`; add "save this search as a smart album" from the search toolbar.
