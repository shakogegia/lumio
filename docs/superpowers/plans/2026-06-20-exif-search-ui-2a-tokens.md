# EXIF Search UI — Phase 2a: Token-driven filters (Plan 2 of 3, part a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make EXIF search fully usable by *typing* — a user types tokens like
`iso:>800 camera:"Sony A7 IV"` (alongside free text and `@album` chips), the grid
filters by the resulting `FilterSet`, and a read-only chip row shows what was parsed.

**Architecture:** Pure, TDD-tested token helpers in `@lumio/shared`
(`parseFilterTokens`, `ruleToToken`, `formatRuleLabel`) translate between the
search box's raw text and `FilterRule[]`. The search box's text stays the single
source of truth for EXIF rules + free text; `SearchFilters` gains a `rules` field;
`paramsFor` serializes those rules into the `?filter=<json>` param the Phase-1
backend already accepts; a read-only chip row renders `formatRuleLabel`. No
contenteditable surgery and no dual state — removable chips and the facet panel are
Phase 2b.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, React 19 / Next 16,
`@lumio/shared` field registry (`resolveField`, `FilterRule`, `FieldType`, `RuleOp`).

**Spec:** `docs/superpowers/specs/2026-06-20-exif-search-design.md`
**Builds on:** Plan 1 (backend) — `FilterSet`/`FilterRule`/`filterSetSchema`, the
field registry, `GET /api/search?filter=<json>`, `/api/exif/{fields,values}`.

**Scope of this plan (2a):** token parse/serialize/format helpers; `SearchFilters`
carrying `rules`; query plumbing (`buildFilters`/`paramsFor`/`serialize`); the search
input parsing tokens + replaying them on recent-search recall; a **read-only** chip
row; recents storing/validating rules. **Out of scope (Phase 2b):** the facet panel,
curated widgets (multiselect/range/date), discovery-endpoint wiring, removable chips,
`match: any` toggle in the UI.

**Token grammar (agreed):**
- `camera:"Sony A7 IV"` → contains (quote values with spaces); `camera:=Sony` → eq
- `iso:>800` `iso:>=800` `iso:<2.8` `iso:<=2.8` → range; `iso:200..1600` → between
- `lens:?` → exists; `lens:!?` → not_exists
- unknown keys fall through to JSONB: `LightSource:Daylight`, `exif.Flash:16`
- `album` tokens are NOT parsed (albums use the `@album` chip mechanism)

**Conventions:** local imports use the `.js` extension (ESM). Run one test file with
`pnpm --filter <pkg> exec vitest run <relative-path>`. Commit after each task.

---

### Task 1: `parseFilterTokens` (shared)

**Files:**
- Create: `packages/shared/src/filter-tokens.ts`
- Create: `packages/shared/src/filter-tokens.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/filter-tokens.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RuleOp } from "./enums.js";
import { parseFilterTokens } from "./filter-tokens.js";

describe("parseFilterTokens", () => {
  it("leaves plain words as free text, no rules", () => {
    expect(parseFilterTokens("sunset beach")).toEqual({ rules: [], text: "sunset beach" });
  });

  it("parses a numeric comparison on a promoted field", () => {
    expect(parseFilterTokens("iso:>800")).toEqual({
      rules: [{ field: "iso", op: RuleOp.gt, value: 800 }],
      text: "",
    });
  });

  it("parses >= <= < and = ", () => {
    expect(parseFilterTokens("iso:>=800").rules[0]).toEqual({ field: "iso", op: RuleOp.gte, value: 800 });
    expect(parseFilterTokens("aperture:<=2.8").rules[0]).toEqual({ field: "aperture", op: RuleOp.lte, value: 2.8 });
    expect(parseFilterTokens("aperture:<2.8").rules[0]).toEqual({ field: "aperture", op: RuleOp.lt, value: 2.8 });
    expect(parseFilterTokens("iso:=100").rules[0]).toEqual({ field: "iso", op: RuleOp.eq, value: 100 });
  });

  it("parses a between range", () => {
    expect(parseFilterTokens("iso:200..1600").rules[0]).toEqual({
      field: "iso", op: RuleOp.between, value: [200, 1600],
    });
  });

  it("bare value on a string field → contains; alias resolves to canonical key", () => {
    expect(parseFilterTokens("camera:Sony").rules[0]).toEqual({
      field: "cameraModel", op: RuleOp.contains, value: "Sony",
    });
  });

  it("quoted value preserves spaces", () => {
    expect(parseFilterTokens('camera:"Sony A7 IV" beach')).toEqual({
      rules: [{ field: "cameraModel", op: RuleOp.contains, value: "Sony A7 IV" }],
      text: "beach",
    });
  });

  it("exists / not_exists", () => {
    expect(parseFilterTokens("lens:?").rules[0]).toEqual({ field: "lensModel", op: RuleOp.exists });
    expect(parseFilterTokens("lens:!?").rules[0]).toEqual({ field: "lensModel", op: RuleOp.not_exists });
  });

  it("unknown key falls through to a generic exif.<Key> rule", () => {
    expect(parseFilterTokens("LightSource:Daylight").rules[0]).toEqual({
      field: "exif.LightSource", op: RuleOp.contains, value: "Daylight",
    });
  });

  it("numeric comparison on a generic exif key coerces to a number", () => {
    expect(parseFilterTokens("exif.Flash:>5").rules[0]).toEqual({
      field: "exif.Flash", op: RuleOp.gt, value: 5,
    });
  });

  it("album tokens are NOT parsed (handled by @album chips) — kept as free text", () => {
    expect(parseFilterTokens("album:Trip")).toEqual({ rules: [], text: "album:Trip" });
  });

  it("an invalid op for the field is left as free text", () => {
    // ne is not a valid op typed form, and `>` on a string column is invalid → free text
    expect(parseFilterTokens("hasGps:>3")).toEqual({ rules: [], text: "hasGps:>3" });
  });

  it("non-numeric value on a numeric field is left as free text", () => {
    expect(parseFilterTokens("iso:abc")).toEqual({ rules: [], text: "iso:abc" });
  });

  it("mixes rules and free text, preserving leftover order", () => {
    const out = parseFilterTokens("beach iso:>800 sunset");
    expect(out.rules).toEqual([{ field: "iso", op: RuleOp.gt, value: 800 }]);
    expect(out.text).toBe("beach sunset");
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @lumio/shared exec vitest run src/filter-tokens.test.ts`
Expected: FAIL ("Cannot find module './filter-tokens.js'").

- [ ] **Step 3: Implement**

`packages/shared/src/filter-tokens.ts`:

```ts
import { RuleOp } from "./enums.js";
import { type FieldDef, FieldType, type FilterRule, type FilterValue, resolveField } from "./filters.js";

// Match whitespace-separated tokens, keeping a quoted value (which may contain
// spaces) attached to its `field:` prefix, e.g. `camera:"Sony A7 IV"`.
const TOKEN_RE = /\S+:"[^"]*"|\S+/g;

function stripQuotes(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

const COMPARISON_OPS = new Set<RuleOp>([RuleOp.gt, RuleOp.gte, RuleOp.lt, RuleOp.lte, RuleOp.between]);

/** Coerce a raw string to the value type the field expects, or undefined if invalid. */
function coerceScalar(def: FieldDef, op: RuleOp, raw: string): FilterValue | undefined {
  const v = stripQuotes(raw);
  if (v === "") return undefined;
  if (def.type === FieldType.number) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (def.type === FieldType.bool) {
    if (/^(true|1|yes)$/i.test(v)) return true;
    if (/^(false|0|no)$/i.test(v)) return false;
    return undefined;
  }
  // string (string column, date, or generic JSON): numeric-coerce only for
  // comparison ops so generic numeric EXIF keys compare numerically.
  if (def.type === FieldType.string && COMPARISON_OPS.has(op)) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return v;
}

/** Parse one `field:...` token into a rule, or null if it isn't a valid filter token. */
function tokenToRule(token: string): FilterRule | null {
  const colon = token.indexOf(":");
  if (colon <= 0) return null;
  const fieldPart = token.slice(0, colon);
  const valuePart = token.slice(colon + 1);
  if (valuePart === "") return null;

  const def = resolveField(fieldPart);
  if (def.storage.kind === "album") return null; // albums use @album chips

  // operator + raw value
  let op: RuleOp;
  let raw: string;
  const unquoted = stripQuotes(valuePart) === valuePart; // not a "quoted" value
  if (valuePart === "?") {
    op = RuleOp.exists;
    raw = "";
  } else if (valuePart === "!?") {
    op = RuleOp.not_exists;
    raw = "";
  } else if (unquoted && valuePart.startsWith(">=")) {
    op = RuleOp.gte;
    raw = valuePart.slice(2);
  } else if (unquoted && valuePart.startsWith("<=")) {
    op = RuleOp.lte;
    raw = valuePart.slice(2);
  } else if (unquoted && valuePart.startsWith(">")) {
    op = RuleOp.gt;
    raw = valuePart.slice(1);
  } else if (unquoted && valuePart.startsWith("<")) {
    op = RuleOp.lt;
    raw = valuePart.slice(1);
  } else if (unquoted && valuePart.startsWith("=")) {
    op = RuleOp.eq;
    raw = valuePart.slice(1);
  } else if (unquoted && valuePart.includes("..")) {
    op = RuleOp.between;
    raw = valuePart;
  } else {
    op = def.type === FieldType.string ? RuleOp.contains : RuleOp.eq;
    raw = valuePart;
  }

  if (!def.ops.includes(op)) return null;

  if (op === RuleOp.exists || op === RuleOp.not_exists) {
    return { field: def.key, op };
  }
  if (op === RuleOp.between) {
    const [a, b] = raw.split("..");
    const va = coerceScalar(def, op, a ?? "");
    const vb = coerceScalar(def, op, b ?? "");
    if (va === undefined || vb === undefined) return null;
    return { field: def.key, op, value: [va, vb] as [number, number] | [string, string] };
  }
  const value = coerceScalar(def, op, raw);
  if (value === undefined) return null;
  return { field: def.key, op, value };
}

/**
 * Split a search box's raw text into structured EXIF filter rules + the leftover
 * free text (the filename query). Tokens that don't resolve to a valid rule are
 * kept verbatim in the free text.
 */
export function parseFilterTokens(text: string): { rules: FilterRule[]; text: string } {
  const rules: FilterRule[] = [];
  const leftover: string[] = [];
  for (const token of text.match(TOKEN_RE) ?? []) {
    const rule = tokenToRule(token);
    if (rule) rules.push(rule);
    else leftover.push(token);
  }
  return { rules, text: leftover.join(" ").trim() };
}
```

- [ ] **Step 4: Export it**

In `packages/shared/src/index.ts` add:

```ts
export * from "./filter-tokens.js";
```

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @lumio/shared exec vitest run src/filter-tokens.test.ts`
Expected: PASS (all cases). Then `pnpm --filter @lumio/shared typecheck` → clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/filter-tokens.ts packages/shared/src/filter-tokens.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): parseFilterTokens — search tokens → FilterRule[]"
```

---

### Task 2: `ruleToToken` + `formatRuleLabel` (shared)

**Files:**
- Modify: `packages/shared/src/filter-tokens.ts` (append)
- Modify: `packages/shared/src/filter-tokens.test.ts` (append)

- [ ] **Step 1: Write the failing test (append to `filter-tokens.test.ts`)**

```ts
import { ruleToToken, formatRuleLabel } from "./filter-tokens.js";

describe("ruleToToken", () => {
  it("serializes each op back to token form", () => {
    expect(ruleToToken({ field: "iso", op: RuleOp.gt, value: 800 })).toBe("iso:>800");
    expect(ruleToToken({ field: "iso", op: RuleOp.gte, value: 800 })).toBe("iso:>=800");
    expect(ruleToToken({ field: "aperture", op: RuleOp.lte, value: 2.8 })).toBe("aperture:<=2.8");
    expect(ruleToToken({ field: "iso", op: RuleOp.eq, value: 100 })).toBe("iso:=100");
    expect(ruleToToken({ field: "iso", op: RuleOp.between, value: [200, 1600] })).toBe("iso:200..1600");
    expect(ruleToToken({ field: "lensModel", op: RuleOp.exists })).toBe("lensModel:?");
    expect(ruleToToken({ field: "lensModel", op: RuleOp.not_exists })).toBe("lensModel:!?");
    expect(ruleToToken({ field: "cameraModel", op: RuleOp.contains, value: "Sony" })).toBe("cameraModel:Sony");
  });

  it("quotes values containing spaces", () => {
    expect(ruleToToken({ field: "cameraModel", op: RuleOp.contains, value: "Sony A7 IV" })).toBe(
      'cameraModel:"Sony A7 IV"',
    );
  });

  it("round-trips through parseFilterTokens", () => {
    const rules = [
      { field: "iso", op: RuleOp.gte, value: 800 },
      { field: "cameraModel", op: RuleOp.contains, value: "Sony A7 IV" },
      { field: "iso", op: RuleOp.between, value: [200, 1600] },
      { field: "lensModel", op: RuleOp.exists },
    ] as const;
    for (const rule of rules) {
      expect(parseFilterTokens(ruleToToken(rule)).rules[0]).toEqual(rule);
    }
  });
});

describe("formatRuleLabel", () => {
  it("renders human chip labels via the registry", () => {
    expect(formatRuleLabel({ field: "iso", op: RuleOp.gte, value: 800 })).toBe("ISO ≥ 800");
    expect(formatRuleLabel({ field: "cameraModel", op: RuleOp.contains, value: "Sony" })).toBe(
      "Camera contains Sony",
    );
    expect(formatRuleLabel({ field: "iso", op: RuleOp.between, value: [200, 1600] })).toBe("ISO: 200–1600");
    expect(formatRuleLabel({ field: "lensModel", op: RuleOp.exists })).toBe("Lens is set");
    expect(formatRuleLabel({ field: "exif.LightSource", op: RuleOp.contains, value: "Daylight" })).toBe(
      "LightSource contains Daylight",
    );
  });
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @lumio/shared exec vitest run src/filter-tokens.test.ts`
Expected: FAIL (`ruleToToken` / `formatRuleLabel` undefined).

- [ ] **Step 3: Implement (append to `filter-tokens.ts`)**

```ts
const OP_PREFIX: Partial<Record<RuleOp, string>> = {
  [RuleOp.gt]: ">",
  [RuleOp.gte]: ">=",
  [RuleOp.lt]: "<",
  [RuleOp.lte]: "<=",
  [RuleOp.eq]: "=",
};

function quoteIfNeeded(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

/** Inverse of parseFilterTokens for a single rule (used to replay recent searches). */
export function ruleToToken(rule: FilterRule): string {
  const f = rule.field;
  if (rule.op === RuleOp.exists) return `${f}:?`;
  if (rule.op === RuleOp.not_exists) return `${f}:!?`;
  if (rule.op === RuleOp.between) {
    const [a, b] = rule.value as [unknown, unknown];
    return `${f}:${a}..${b}`;
  }
  if (rule.op === RuleOp.contains) return `${f}:${quoteIfNeeded(String(rule.value))}`;
  const prefix = OP_PREFIX[rule.op] ?? "";
  return `${f}:${prefix}${quoteIfNeeded(String(rule.value))}`;
}

/** Human-readable label for a rule chip, e.g. "ISO ≥ 800", "Camera contains Sony". */
export function formatRuleLabel(rule: FilterRule): string {
  const name = resolveField(rule.field).label;
  switch (rule.op) {
    case RuleOp.exists:
      return `${name} is set`;
    case RuleOp.not_exists:
      return `${name} not set`;
    case RuleOp.last_30_days:
      return `${name}: last 30 days`;
    case RuleOp.between: {
      const [a, b] = rule.value as [unknown, unknown];
      return `${name}: ${a}–${b}`;
    }
    case RuleOp.contains:
      return `${name} contains ${String(rule.value)}`;
    case RuleOp.ne:
      return `${name} ≠ ${String(rule.value)}`;
    case RuleOp.gt:
      return `${name} > ${String(rule.value)}`;
    case RuleOp.gte:
      return `${name} ≥ ${String(rule.value)}`;
    case RuleOp.lt:
      return `${name} < ${String(rule.value)}`;
    case RuleOp.lte:
      return `${name} ≤ ${String(rule.value)}`;
    default:
      return `${name} = ${String(rule.value)}`;
  }
}
```

> `formatRuleLabel`'s `default` covers `eq` (and any future op) as `Name = value`.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @lumio/shared exec vitest run src/filter-tokens.test.ts`
Expected: PASS (parse + serialize + format + round-trip). Then `pnpm --filter @lumio/shared test` → green.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/filter-tokens.ts packages/shared/src/filter-tokens.test.ts
git commit -m "feat(shared): ruleToToken + formatRuleLabel (round-trip + chip labels)"
```

---

### Task 3: `SearchFilters` carries `rules`; query plumbing

**Files:**
- Modify: `apps/web/src/app/(app)/search/filters.ts`
- Modify: `apps/web/src/app/(app)/search/filters.test.ts`

- [ ] **Step 1: Update the filters test (keep existing cases; add rules cases)**

Open `apps/web/src/app/(app)/search/filters.test.ts` and:
- import `RuleOp` from `@lumio/shared` at the top.
- Update existing `buildFilters` expectations to include `rules: []` (the new field is always present). For example a case that expected `{ albums: [...], q: "..." }` now expects `{ albums: [...], q: "...", rules: [...] }`.
- Add these cases:

```ts
it("buildFilters parses EXIF tokens out of the text into rules, leaving free text in q", () => {
  expect(buildFilters([], "iso:>800 beach")).toEqual({
    albums: [],
    q: "beach",
    rules: [{ field: "iso", op: RuleOp.gt, value: 800 }],
  });
});

it("paramsFor appends a filter=<json> param when rules are present", () => {
  const params = paramsFor({ albums: ["a1"], q: "beach", rules: [{ field: "iso", op: RuleOp.gt, value: 800 }] });
  expect(params.getAll("album")).toEqual(["a1"]);
  expect(params.get("q")).toBe("beach");
  expect(JSON.parse(params.get("filter")!)).toEqual({
    match: "all",
    rules: [{ field: "iso", op: RuleOp.gt, value: 800 }],
  });
});

it("paramsFor omits filter when there are no rules", () => {
  expect(paramsFor({ albums: [], q: "beach", rules: [] }).get("filter")).toBeNull();
});

it("serialize includes the rules so the grid remounts when they change", () => {
  const a = serialize({ albums: [], q: "", rules: [{ field: "iso", op: RuleOp.gt, value: 800 }] });
  const b = serialize({ albums: [], q: "", rules: [{ field: "iso", op: RuleOp.gt, value: 400 }] });
  expect(a).not.toBe(b);
});
```

- [ ] **Step 2: Run it to verify failure**

Run: `pnpm --filter @lumio/web exec vitest run "src/app/(app)/search/filters.test.ts"`
Expected: FAIL (no `rules` on SearchFilters; `paramsFor` lacks `filter`).

- [ ] **Step 3: Implement** — replace `apps/web/src/app/(app)/search/filters.ts` with:

```ts
import { DEFAULT_PHOTO_SORT, type FilterRule, MatchType, type PhotoSort, parseFilterTokens } from "@lumio/shared";

/**
 * The structured search state the rest of the app consumes. `rules` are the EXIF
 * filter rules parsed from the box text (album chips + free text are separate).
 */
export interface SearchFilters {
  albums: string[];
  q: string;
  rules: FilterRule[];
}

/** Build normalized filters from album ids + the box's raw text. EXIF tokens in the
 *  text are parsed into `rules`; the remaining free text becomes `q`. */
export function buildFilters(albums: string[], rawText: string): SearchFilters {
  const { rules, text } = parseFilterTokens(rawText.replace(/ /g, " ").trim());
  return {
    albums: Array.from(new Set(albums.filter(Boolean))),
    q: text,
    rules,
  };
}

/** Filters → query string for GET /api/search (album repeats; q + filter only when
 *  set; sort only when not the default). */
export function paramsFor(
  filters: SearchFilters,
  sort: PhotoSort = DEFAULT_PHOTO_SORT,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const album of filters.albums) params.append("album", album);
  if (filters.q) params.set("q", filters.q);
  if (filters.rules.length > 0) {
    params.set("filter", JSON.stringify({ match: MatchType.all, rules: filters.rules }));
  }
  if (sort !== DEFAULT_PHOTO_SORT) params.set("sort", sort);
  return params;
}

/** Stable key for remounting the results grid when the filters change. */
export function serialize(filters: SearchFilters): string {
  return JSON.stringify({ albums: [...filters.albums].sort(), q: filters.q, rules: filters.rules });
}

/**
 * Query string carried on a result photo's detail URL so the detail view scopes
 * its prev/next + film strip to the search results. The `s=1` marker tells the
 * detail page to treat the params as a search filter (vs. the album scope).
 */
export function scopeQuery(
  filters: SearchFilters,
  sort: PhotoSort = DEFAULT_PHOTO_SORT,
): string {
  const params = paramsFor(filters, sort);
  params.set("s", "1");
  return params.toString();
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @lumio/web exec vitest run "src/app/(app)/search/filters.test.ts"`
Expected: PASS (existing updated cases + new ones).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/search/filters.ts" "apps/web/src/app/(app)/search/filters.test.ts"
git commit -m "feat(search): SearchFilters carries EXIF rules; paramsFor emits filter param"
```

---

### Task 4: Search input — parse on read, replay on recall

**Files:**
- Modify: `apps/web/src/app/(app)/search/search-input.tsx`

`buildFilters` already parses (Task 3), and `readEditor` already calls
`buildFilters(albums, rawText)` — so live typing produces `rules` with no change to
`readEditor`. The only change needed is `applyFilters` (recent-search recall): it must
put EXIF rules back into the box as tokens so they re-parse.

- [ ] **Step 1: Update `applyFilters` to replay rule tokens**

In `apps/web/src/app/(app)/search/search-input.tsx`, add `ruleToToken` to the shared
import and update the `applyFilters` body inside `useImperativeHandle` so that, after
appending album chips, it appends the rule tokens followed by the free text. Replace
the existing text-append line:

```tsx
            if (filters.q) el.appendChild(document.createTextNode(filters.q));
```

with:

```tsx
            const tokens = filters.rules.map(ruleToToken).join(" ");
            const trailing = [tokens, filters.q].filter(Boolean).join(" ");
            if (trailing) el.appendChild(document.createTextNode(trailing));
```

And add the import (merge into the existing import from the filters module's siblings —
`ruleToToken` comes from `@lumio/shared`):

```tsx
import { ruleToToken } from "@lumio/shared";
```

(Everything else in `search-input.tsx` — `readEditor`, chip handling, Tribute — stays
as-is; `readEditor` returns `buildFilters(albums, rawText)` which now includes `rules`.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean (the `SearchFilters` shape change ripples here; `applyFilters` now reads `filters.rules`).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/search/search-input.tsx"
git commit -m "feat(search): replay EXIF rule tokens when recalling a recent search"
```

---

### Task 5: Read-only chip row + recents carry rules

**Files:**
- Modify: `apps/web/src/app/(app)/search/search-view.tsx`
- Modify: `apps/web/src/app/(app)/search/recent-searches.tsx`

- [ ] **Step 1: Update `search-view.tsx` — EMPTY/isEmptyFilters + a read-only chip row**

In `apps/web/src/app/(app)/search/search-view.tsx`:

Add `formatRuleLabel` to a `@lumio/shared` import at the top:

```tsx
import { formatRuleLabel } from "@lumio/shared";
```

Replace the `EMPTY` constant and `isEmptyFilters`:

```tsx
const EMPTY: SearchFilters = { albums: [], q: "", rules: [] };

function isEmptyFilters(f: SearchFilters): boolean {
  return f.albums.length === 0 && f.q === "" && f.rules.length === 0;
}
```

Then render a read-only chip row of the active rules immediately below the
`SearchInput` (inside the sticky header's `max-w-2xl` wrapper, right after the
`<SearchInput ... />` element):

```tsx
            {filters.rules.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {filters.rules.map((rule, i) => (
                  <span
                    key={`${rule.field}:${rule.op}:${i}`}
                    className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground"
                  >
                    {formatRuleLabel(rule)}
                  </span>
                ))}
              </div>
            )}
```

(The chips are read-only in 2a — to change a rule the user edits the box text.
Removable chips arrive in Phase 2b.)

- [ ] **Step 2: Update `recent-searches.tsx` — store/validate/replay rules**

In `apps/web/src/app/(app)/search/recent-searches.tsx`:

Update `isEmptyFilters` to include rules:

```tsx
function isEmptyFilters(f: SearchFilters): boolean {
  return f.albums.length === 0 && f.q === "" && f.rules.length === 0;
}
```

Harden `loadRecentSearches`'s validation + normalize missing `rules` to `[]` (so
older stored entries without `rules` still load). Replace the `.filter(...)` predicate
body with one that also requires/normalizes `rules`:

```tsx
    return parsed
      .filter(
        (f): f is SearchFilters =>
          !!f &&
          Array.isArray((f as SearchFilters).albums) &&
          typeof (f as SearchFilters).q === "string",
      )
      .map((f) => ({ ...f, rules: Array.isArray(f.rules) ? f.rules : [] }));
```

Add `formatRuleLabel` to the `@lumio/shared` import and render rule chips in each
recent row, right after the album chips block (inside the `flex flex-wrap` span):

```tsx
                {filters.rules.map((rule, i) => (
                  <span
                    key={`r${i}`}
                    className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground"
                  >
                    {formatRuleLabel(rule)}
                  </span>
                ))}
```

(`recordRecentSearch` already serializes the whole `SearchFilters`, so `rules` persist
with no change; `serialize` (Task 3) now includes `rules` so dedup keys differ when
rules differ.)

- [ ] **Step 3: Typecheck + web suite**

Run: `pnpm --filter @lumio/web exec tsc --noEmit` → clean.
Run: `pnpm --filter @lumio/web test` → green (existing 180 + the filters cases).

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/search/search-view.tsx" "apps/web/src/app/(app)/search/recent-searches.tsx"
git commit -m "feat(search): read-only EXIF rule chips + recents carry rules"
```

---

### Task 6: Verification + browser smoke

**Files:** none (verification)

- [ ] **Step 1: Full suite + typecheck + lint**

Run: `pnpm -r test` → all packages green (note: shared gains the filter-tokens tests; web gains the filters cases).
Run: `pnpm --filter @lumio/web exec tsc --noEmit` and `pnpm -r --if-present typecheck` → clean.
Run: `pnpm --filter @lumio/web lint` → no NEW errors (the 2 pre-existing `react-hooks/refs` errors in `use-activity.ts`/`use-async-job.ts` are unrelated — do not fix here).

- [ ] **Step 2: Browser smoke (manual / Claude-in-Chrome)**

With the dev server running and an authenticated session, open `/search` and verify:
- Typing `iso:>800` filters the grid and shows a chip "ISO > 800"; the count updates.
- `camera:"Sony A7 IV"` (or a camera present in the library, e.g. `camera:D800`) filters and shows "Camera contains D800".
- `lens:?` shows "Lens is set"; free text alongside a token (e.g. `D800 iso:>100`) still does a filename match on the free word.
- A recalled recent search repopulates the box with the tokens and re-filters.
- The network request to `/api/search` carries a `filter=<json>` param.

> If browser verification is blocked (e.g. login), record that it was not completed
> and rely on the unit/integration coverage + a code review of the wiring, matching
> how Phase-1 search-toolbar verification was handled.

- [ ] **Step 3: Commit (only if lint autofixes)**

```bash
git add -A && git commit -m "chore: exif-search 2a — suite green" || echo "nothing to commit"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (token half of the hybrid UI):** token grammar (Task 1) ✓; token
  serialize for recall + chip labels (Task 2) ✓; `FilterSet` over the wire via the
  `filter` param (Task 3) ✓; live parsing in the input (Task 4, via `buildFilters`) ✓;
  rule chips + recents (Task 5) ✓. **Deferred to 2b:** facet panel, curated widgets,
  discovery wiring, removable chips, `match:any` toggle.
- **Type consistency:** `SearchFilters` gains `rules: FilterRule[]` in Task 3 and every
  consumer (search-input Task 4, search-view + recent-searches Task 5, use-search-count
  via `paramsFor`/`serialize`) is updated; `EMPTY`/`isEmptyFilters` updated in both
  `search-view.tsx` and `recent-searches.tsx`. `parseFilterTokens`/`ruleToToken`/
  `formatRuleLabel` signatures are stable across Tasks 1–5. `MatchType.all` is the
  serialized `match` (the read-only UI is AND-only in 2a).
- **No placeholders:** every code step has complete code; commands have expected output.

## Follow-on (Phase 2b — separate plan)

The facet panel: a toolbar filter button → popover with curated widgets (camera/lens
multiselect with counts from `/api/exif/values`, ISO/aperture/focal range, date range,
has-GPS + orientation toggles) and a generic "＋ Add filter" row fed by
`/api/exif/fields`; making the chip row removable and bidirectionally synced with the
panel; an optional all/any toggle. Phase 3 then reuses these widgets in the smart-album
rule-builder and adds "save this search as a smart album".
