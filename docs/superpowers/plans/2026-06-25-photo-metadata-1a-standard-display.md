# Photo Metadata 1a — Standard Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a photo's standardized EXIF (camera, exposure, aperture, focal length, date) as an icon-led summary at the top of the lightbox Info tab, matching the reference screenshot — and establish the shared **standard-field registry** that the rest of the metadata feature builds on.

**Architecture:** A pure `STANDARD_FIELDS` registry in `@lumio/shared` maps a small set of standard field keys to formatted values pulled from the existing `Photo.exif` blob (no new EXIF reads, no DB, no migration). A presentational `StandardMetadata` React component arranges those values into icon-led lines and replaces the hardcoded Camera/Taken rows in the lightbox sidebar. This is the always-on baseline from the spec (`docs/superpowers/specs/2026-06-25-photo-metadata-design.md`); custom fields, presets, the value store, and the feature gate come in later plans.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Vitest, React 19, Next.js 16, lucide-react icons, Tailwind.

---

## File structure

- Create `packages/shared/src/metadata-standard.ts` — `StandardFieldKey` enum, `STANDARD_FIELDS` registry, `resolveStandardFields(exif)`, and the value formatters. Pure; no Prisma/Next/Node.
- Create `packages/shared/src/metadata-standard.test.ts` — unit tests for formatters + resolver.
- Modify `packages/shared/src/index.ts` — re-export the new module.
- Create `apps/web/src/features/lightbox/standard-metadata.tsx` — the icon-led presentational component.
- Create `apps/web/src/features/lightbox/standard-metadata.test.tsx` — render tests.
- Modify `apps/web/src/features/lightbox/lightbox-sidebar.tsx:69-82` — use the new component in the Info tab.

Type referenced across tasks: `ExifData` (already exported from `@lumio/shared`; an object map of EXIF keys → unknown).

---

### Task 1: Standard-field formatters + registry (shared)

**Files:**
- Create: `packages/shared/src/metadata-standard.ts`
- Test: `packages/shared/src/metadata-standard.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/metadata-standard.test.ts
import { describe, expect, it } from "vitest";
import {
  StandardFieldKey,
  formatShutter,
  formatAperture,
  formatFocal,
  formatCamera,
  resolveStandardFields,
  standardMetadataLines,
} from "./metadata-standard.js";

describe("formatters", () => {
  it("formats shutter as a reciprocal under 1s and seconds at/above 1s", () => {
    expect(formatShutter(0.01)).toBe("1/100 s");
    expect(formatShutter(0.002)).toBe("1/500 s");
    expect(formatShutter(1)).toBe("1 s");
    expect(formatShutter(2)).toBe("2 s");
    expect(formatShutter(0.5)).toBe("1/2 s");
    expect(formatShutter(undefined)).toBeNull();
    expect(formatShutter(0)).toBeNull();
  });

  it("formats aperture with an f-stop glyph", () => {
    expect(formatAperture(8)).toBe("ƒ/8");
    expect(formatAperture(2.8)).toBe("ƒ/2.8");
    expect(formatAperture(undefined)).toBeNull();
  });

  it("formats focal length in millimetres", () => {
    expect(formatFocal(55)).toBe("55 mm");
    expect(formatFocal(60)).toBe("60 mm");
    expect(formatFocal(undefined)).toBeNull();
  });

  it("joins make + model without duplicating the make", () => {
    expect(formatCamera("SONY", "ILCE-6400")).toBe("SONY ILCE-6400");
    expect(formatCamera("NIKON CORPORATION", "NIKON D800")).toBe("NIKON D800");
    expect(formatCamera(undefined, "ILCE-6400")).toBe("ILCE-6400");
    expect(formatCamera("SONY", undefined)).toBe("SONY");
    expect(formatCamera(undefined, undefined)).toBeNull();
  });
});

describe("resolveStandardFields", () => {
  it("pulls formatted values from an exif blob, preferring curated aliases", () => {
    const r = resolveStandardFields({
      cameraMake: "SONY",
      cameraModel: "ILCE-6400",
      ISO: 3200,
      ExposureTime: 0.002,
      FNumber: 10,
      FocalLength: 55,
      DateTimeOriginal: "2024-08-01T20:38:12.000Z",
    });
    expect(r[StandardFieldKey.Camera]).toBe("SONY ILCE-6400");
    expect(r[StandardFieldKey.Iso]).toBe("ISO 3200");
    expect(r[StandardFieldKey.Shutter]).toBe("1/500 s");
    expect(r[StandardFieldKey.Aperture]).toBe("ƒ/10");
    expect(r[StandardFieldKey.Focal]).toBe("55 mm");
    expect(r[StandardFieldKey.Date]).toBe("Aug 1, 2024");
  });

  it("falls back to Make/Model and yields null for missing fields", () => {
    const r = resolveStandardFields({ Make: "Canon", Model: "EOS R" });
    expect(r[StandardFieldKey.Camera]).toBe("Canon EOS R");
    expect(r[StandardFieldKey.Iso]).toBeNull();
    expect(r[StandardFieldKey.Shutter]).toBeNull();
    expect(r[StandardFieldKey.Date]).toBeNull();
  });
});

describe("standardMetadataLines", () => {
  it("composes the exposure and optics lines", () => {
    const lines = standardMetadataLines({
      cameraMake: "SONY",
      cameraModel: "ILCE-6400",
      ISO: 3200,
      ExposureTime: 0.002,
      FNumber: 10,
      FocalLength: 55,
      DateTimeOriginal: "2024-08-01T20:38:12.000Z",
    });
    expect(lines).toEqual({
      camera: "SONY ILCE-6400",
      exposure: "1/500 s  ISO 3200",
      optics: "ƒ/10  55 mm",
      date: "Aug 1, 2024",
    });
  });

  it("returns null when no standard field is present", () => {
    expect(standardMetadataLines({})).toBeNull();
    expect(standardMetadataLines({ Orientation: 1, ThumbnailLength: 10 })).toBeNull();
  });

  it("includes only the lines that have data", () => {
    const lines = standardMetadataLines({ FNumber: 8 });
    expect(lines).toEqual({ camera: null, exposure: null, optics: "ƒ/8", date: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared test -- metadata-standard`
Expected: FAIL — cannot find module `./metadata-standard.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/shared/src/metadata-standard.ts
import type { ExifData } from "./types.js";

/** The small set of standardized fields shown icon-led in the Info tab. */
export enum StandardFieldKey {
  Camera = "camera",
  Lens = "lens",
  Iso = "iso",
  Shutter = "shutter",
  Aperture = "aperture",
  Focal = "focal",
  Date = "date",
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** ExposureTime (seconds) → "1/100 s" under 1s, "2 s" at/above. */
export function formatShutter(seconds: unknown): string | null {
  const t = num(seconds);
  if (t === undefined || t <= 0) return null;
  if (t >= 1) return `${Number.isInteger(t) ? t : Number(t.toFixed(1))} s`;
  return `1/${Math.round(1 / t)} s`;
}

/** FNumber → "ƒ/8". */
export function formatAperture(fnumber: unknown): string | null {
  const f = num(fnumber);
  if (f === undefined || f <= 0) return null;
  return `ƒ/${Number(f.toFixed(1)).toString().replace(/\.0$/, "")}`;
}

/** FocalLength → "55 mm". */
export function formatFocal(mm: unknown): string | null {
  const f = num(mm);
  if (f === undefined || f <= 0) return null;
  return `${Number(f.toFixed(1)).toString().replace(/\.0$/, "")} mm`;
}

/** Make + Model, de-duplicated (Model frequently repeats the Make). Match on the
 *  FIRST WORD of make so "NIKON CORPORATION" + "NIKON D800" → "NIKON D800". */
export function formatCamera(make: unknown, model: unknown): string | null {
  const mk = str(make);
  const md = str(model);
  if (mk && md) {
    const mkFirst = mk.split(/\s+/)[0]!;
    return md.toLowerCase().startsWith(mkFirst.toLowerCase()) ? md : `${mk} ${md}`;
  }
  return md ?? mk ?? null;
}

function formatDate(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export type StandardFieldValues = Record<StandardFieldKey, string | null>;

/** Resolve every standard field to a display string (or null) from an exif blob. */
export function resolveStandardFields(exif: ExifData): StandardFieldValues {
  const e = exif as Record<string, unknown>;
  const iso = num(e.ISO);
  return {
    [StandardFieldKey.Camera]: formatCamera(e.cameraMake ?? e.Make, e.cameraModel ?? e.Model),
    [StandardFieldKey.Lens]: str(e.LensModel) ?? null,
    [StandardFieldKey.Iso]: iso === undefined ? null : `ISO ${iso}`,
    [StandardFieldKey.Shutter]: formatShutter(e.ExposureTime),
    [StandardFieldKey.Aperture]: formatAperture(e.FNumber),
    [StandardFieldKey.Focal]: formatFocal(e.FocalLength),
    [StandardFieldKey.Date]: formatDate(e.DateTimeOriginal ?? e.CreateDate),
  };
}

/** The pre-composed lines the icon-led component renders, or null when the photo
 *  carries no standard fields at all. Pure, so the composition + empty-check are
 *  unit-tested in node (the web package has no React render-test harness). */
export interface StandardMetadataLines {
  camera: string | null;
  exposure: string | null; // "1/500 s  ISO 3200"
  optics: string | null; // "ƒ/10  55 mm"
  date: string | null;
}

export function standardMetadataLines(exif: ExifData): StandardMetadataLines | null {
  const f = resolveStandardFields(exif);
  const join = (parts: Array<string | null>) => parts.filter(Boolean).join("  ") || null;
  const lines: StandardMetadataLines = {
    camera: f[StandardFieldKey.Camera],
    exposure: join([f[StandardFieldKey.Shutter], f[StandardFieldKey.Iso]]),
    optics: join([f[StandardFieldKey.Aperture], f[StandardFieldKey.Focal]]),
    date: f[StandardFieldKey.Date],
  };
  if (!lines.camera && !lines.exposure && !lines.optics && !lines.date) return null;
  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared test -- metadata-standard`
Expected: PASS (all cases).

- [ ] **Step 5: Re-export from the shared barrel**

Add to `packages/shared/src/index.ts` (alongside the other `export *` lines):

```ts
export * from "./metadata-standard.js";
```

- [ ] **Step 6: Typecheck + commit**

Run: `pnpm --filter @lumio/shared exec tsc --noEmit` → expect no errors.

```bash
git add packages/shared/src/metadata-standard.ts packages/shared/src/metadata-standard.test.ts packages/shared/src/index.ts
git commit -m "feat(metadata): standard-field registry + EXIF value formatters"
```

---

### Task 2: Icon-led `StandardMetadata` component (web)

**Files:**
- Create: `apps/web/src/features/lightbox/standard-metadata.tsx`

A thin presentational wrapper over the node-tested `standardMetadataLines` helper from Task 1. The web package has **no React render-test harness** (vitest `environment: "node"`, no testing-library, zero `.test.tsx`), and the codebase verifies UI in the browser — so this component gets **no unit test**; its logic lives in (and is tested by) Task 1. Visual correctness is checked in Task 4.

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/features/lightbox/standard-metadata.tsx
import { Camera, Aperture, Calendar } from "lucide-react";
import type { ReactNode } from "react";
import { standardMetadataLines, type ExifData } from "@lumio/shared";

/** Icon-led summary of standardized EXIF, à la Apple Photos. Renders nothing
 *  when the photo carries none of the standard fields. */
export function StandardMetadata({ exif }: { exif: ExifData }) {
  const lines = standardMetadataLines(exif);
  if (!lines) return null;

  return (
    <div className="space-y-3">
      {(lines.camera || lines.exposure) && (
        <Line icon={<Camera className="size-5" aria-hidden />}>
          {lines.camera && <div className="font-medium">{lines.camera}</div>}
          {lines.exposure && <div className="text-muted-foreground">{lines.exposure}</div>}
        </Line>
      )}
      {lines.optics && (
        <Line icon={<Aperture className="size-5" aria-hidden />}>
          <div className="font-medium">{lines.optics}</div>
        </Line>
      )}
      {lines.date && (
        <Line icon={<Calendar className="size-5" aria-hidden />}>
          <div>{lines.date}</div>
        </Line>
      )}
    </div>
  );
}

function Line({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-5 shrink-0 justify-center text-muted-foreground">{icon}</span>
      <div className="min-w-0 leading-tight">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/lightbox/standard-metadata.tsx
git commit -m "feat(metadata): icon-led StandardMetadata component"
```

---

### Task 3: Use `StandardMetadata` in the lightbox Info tab

**Files:**
- Modify: `apps/web/src/features/lightbox/lightbox-sidebar.tsx`

- [ ] **Step 1: Add the import**

At the top of `lightbox-sidebar.tsx`, add:

```tsx
import { StandardMetadata } from "./standard-metadata";
```

- [ ] **Step 2: Replace the Info-tab top rows**

Replace the existing Info `TabsContent` body (currently lines ~69-82) with the standard block on top, a slimmer details group, then album membership. The `camera` local and the `Camera`/`Taken` rows are now redundant — remove the `camera` const (lines ~42-44) too.

Replace:

```tsx
          <TabsContent value={LightboxTab.Info} className="space-y-4">
            <div className="space-y-3">
              <Row label="Source" value={<Badge>{photo.source}</Badge>} />
              <Row label="Taken" value={photo.takenAt ?? "—"} />
              <Row label="File created" value={photo.fileCreatedAt ?? "—"} />
              <Row label="File modified" value={photo.fileModifiedAt ?? "—"} />
              <Row label="Camera" value={camera} />
              <Row label="Hash" value={photo.hash ?? "—"} />
            </div>
            <Separator />
            {/* Keyed on photo.id so membership re-initializes per photo during
              arrow-key navigation. */}
            <AlbumMembership key={photo.id} photo={photo} />
          </TabsContent>
```

with:

```tsx
          <TabsContent value={LightboxTab.Info} className="space-y-4">
            <StandardMetadata exif={photo.exif} />
            <Separator />
            <div className="space-y-3">
              <Row label="Source" value={<Badge>{photo.source}</Badge>} />
              <Row label="File created" value={photo.fileCreatedAt ?? "—"} />
              <Row label="File modified" value={photo.fileModifiedAt ?? "—"} />
              <Row label="Hash" value={photo.hash ?? "—"} />
            </div>
            <Separator />
            {/* Keyed on photo.id so membership re-initializes per photo during
              arrow-key navigation. */}
            <AlbumMembership key={photo.id} photo={photo} />
          </TabsContent>
```

Then delete the now-unused `camera` const:

```tsx
  const camera =
    [photo.exif.cameraMake, photo.exif.cameraModel].filter(Boolean).join(" ") ||
    "—";
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors (no unused-`camera` warning, since it's deleted).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/lightbox/lightbox-sidebar.tsx
git commit -m "feat(metadata): show icon-led standard metadata in the Info tab"
```

---

### Task 4: Full-suite verification + browser smoke

- [ ] **Step 1: Run the touched suites**

Run: `pnpm --filter @lumio/shared test && pnpm --filter @lumio/web test -- standard-metadata`
Expected: all green.

- [ ] **Step 2: Typecheck both packages**

Run: `pnpm --filter @lumio/shared exec tsc --noEmit && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Browser smoke (manual)**

Open a photo's detail view → Info tab. Confirm:
- A digital photo shows camera body + "shutter · ISO", "ƒ/x · focal", and date — like the reference screenshot.
- The film scan `cmqtx7tfj000zms4tfku8w25j` shows its **scanner** standard data (Nikon D800, ƒ/8, 1/100 s) for now — the Bronica/film fields arrive in a later plan.
- A photo with no EXIF hides the block entirely (no empty icons), and Source/file dates/Hash + album membership still render.

- [ ] **Step 4: Note any pre-existing failures**

If the broader `@lumio/db` suite is run and shows 3 `mappers.test.ts` failures (`version: 1` vs `3`), that is a **pre-existing main bug** (EDITS_VERSION bumped without updating the test), unrelated to this plan. Do not fix it here; note it for a separate cleanup.

---

## Self-review

- **Spec coverage:** Implements the spec's "Always-on baseline" (icon-led standard Info-tab block) + the `metadata-standard.ts` registry (spec §"Standard registry (shared)"). Custom fields, models, presets, feature gate, entry surfaces, and search are explicitly out of scope here and covered by later plans (1b / Phase 2).
- **Placeholders:** none — every step has concrete code/commands. The two NOTEs (confirm `ExifData` import path; match the web test harness) are verification instructions, not deferred work.
- **Type consistency:** `StandardFieldKey`, `resolveStandardFields`, `StandardFieldValues`, and the formatter names are used identically across Tasks 1–3. The component consumes `ExifData`, matching `photo.exif`'s type.

## Next plans (not this one)

- **1b-core:** `MetadataGroup`/`MetadataField`/`PhotoMetadataValue` Prisma models + migration (`COLLATE "C"` on `position`); `FeatureKey.Metadata`; db layer (schema/apply-preset/value-upsert/resolve/suggest); gated API routes; custom-field display + single-photo inline edit + autocomplete in the Info tab; built-in Film/Digital presets.
- **1b-scale:** schema-builder settings page; save-as-preset; bulk-fill selection action; upload-time entry panel; per-catalog standard enable/disable + override.
- **Phase 2:** `@field op value` search + smart-album rules (salvage the predicate engine from PR #68).
