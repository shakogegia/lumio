# Rich EXIF Extraction & Folder Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture the full embedded image metadata (EXIF/GPS/XMP/IPTC) instead of four fields, dump it all in the photo detail view, and let the Upload page accept dropped folders while skipping unsupported files.

**Architecture:** A new `packages/ingest/src/metadata.ts` owns extraction (exifr with every block enabled) and JSONB-safe sanitization; `process.ts` delegates to it. Two new pure web helpers (`apps/web/src/lib/exif-entries.ts`, `apps/web/src/lib/upload-collect.ts`) hold the display-flattening and folder-traversal/filter logic so they are unit-testable in a node environment; the two `.tsx` files are thin wiring verified in the browser. No DB migration — the existing `Photo.exif` JSONB column just gets richer contents, backfilled automatically on the next worker restart.

**Tech Stack:** TypeScript, exifr 7, sharp, Prisma/Postgres, Next.js (App Router), Vitest, pnpm workspaces.

**Conventions:** All commits use Conventional Commits and end with the trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` (omitted from the `-m` examples below for brevity — add it).

**Spec:** `docs/superpowers/specs/2026-06-18-rich-exif-and-folder-upload-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `packages/ingest/src/metadata.ts` | `extractMetadata`, `sanitizeMetadata`, `parseExifDate` | Create |
| `packages/ingest/src/metadata.test.ts` | Unit tests for the above | Create |
| `packages/ingest/src/process.ts` | Delegate EXIF work to `metadata.ts` | Modify (lines 1–22, 31–38) |
| `packages/ingest/src/process.test.ts` | Assert richer fields surface | Modify (fixture + assertions) |
| `apps/web/src/lib/exif-entries.ts` | Flatten `ExifData` → sorted `[label, value]` pairs | Create |
| `apps/web/src/lib/exif-entries.test.ts` | Unit tests for the above | Create |
| `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx` | Render the full key/value table | Modify (lines 118–125) |
| `apps/web/src/lib/upload-collect.ts` | Folder traversal + supported-extension filter | Create |
| `apps/web/src/lib/upload-collect.test.ts` | Unit tests for the above | Create |
| `apps/web/src/app/(app)/upload/upload-client.tsx` | Folder drop/picker wiring + skipped count | Modify |

---

## Task 1: `sanitizeMetadata` — make exifr output JSONB-safe

**Files:**
- Create: `packages/ingest/src/metadata.ts`
- Test: `packages/ingest/src/metadata.test.ts`

exifr revives dates to `Date` objects and can return binary blobs; the `Photo.exif` JSONB column needs plain JSON. This pure helper converts `Date → ISO string`, drops `Buffer`/typed-arrays/functions/non-finite numbers, and recurses objects and arrays.

- [ ] **Step 1: Write the failing test**

Create `packages/ingest/src/metadata.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeMetadata } from "./metadata.js";

describe("sanitizeMetadata", () => {
  it("converts Dates to ISO strings", () => {
    const d = new Date("2024-03-14T09:26:53.000Z");
    expect(sanitizeMetadata(d)).toBe("2024-03-14T09:26:53.000Z");
  });

  it("drops Buffers, typed arrays and functions", () => {
    const out = sanitizeMetadata({
      keep: "yes",
      buf: Buffer.from([1, 2, 3]),
      arr: new Uint8Array([4, 5]),
      fn: () => 1,
    }) as Record<string, unknown>;
    expect(out).toEqual({ keep: "yes" });
  });

  it("recurses nested objects and arrays and preserves primitives", () => {
    const out = sanitizeMetadata({
      n: 2.8,
      b: true,
      nested: { d: new Date("2020-01-01T00:00:00.000Z"), list: [1, "x", Buffer.from([0])] },
    });
    expect(out).toEqual({
      n: 2.8,
      b: true,
      nested: { d: "2020-01-01T00:00:00.000Z", list: [1, "x"] },
    });
  });

  it("produces JSON-serialisable output", () => {
    const out = sanitizeMetadata({ d: new Date(), buf: Buffer.from([1]), bad: NaN });
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=UTC pnpm --filter @lumio/ingest exec vitest run src/metadata.test.ts`
Expected: FAIL — `Failed to resolve import "./metadata.js"` / `sanitizeMetadata is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ingest/src/metadata.ts`:

```ts
import exifr from "exifr";
import type { ExifData } from "@lumio/shared";

/**
 * Recursively convert exifr output into a JSON-serialisable value for the
 * `Photo.exif` JSONB column: Date → ISO string; Buffers / typed arrays /
 * functions / non-finite numbers dropped; objects and arrays recursed.
 */
export function sanitizeMetadata(value: unknown): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (value === null) return null;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return undefined;
  }
  if (typeof value === "function") return undefined;
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadata).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = sanitizeMetadata(v);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  return value; // string | number | boolean
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=UTC pnpm --filter @lumio/ingest exec vitest run src/metadata.test.ts`
Expected: PASS (4 passing).

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/metadata.ts packages/ingest/src/metadata.test.ts
git commit -m "feat(ingest): add sanitizeMetadata for JSONB-safe exif"
```

---

## Task 2: `extractMetadata` — read every block, keep curated keys

**Files:**
- Modify: `packages/ingest/src/metadata.ts`
- Test: `packages/ingest/src/metadata.test.ts`

Enable all exifr blocks (incl. embedded XMP), sanitize, and overlay the curated keys (`takenAt`, `cameraMake`, `cameraModel`, `orientation`) that sorting and smart albums depend on. Return both the merged `exif` object and the parsed `takenAt: Date | null` for the DB date columns.

- [ ] **Step 1: Write the failing test**

Append to `packages/ingest/src/metadata.test.ts`:

```ts
import sharp from "sharp";
import { extractMetadata } from "./metadata.js";

/** Splice an XMP APP1 segment (the way embedded XMP lives in a JPEG) right after SOI. */
function embedXmp(jpeg: Buffer, xmpPacket: string): Buffer {
  const sig = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1");
  const payload = Buffer.concat([sig, Buffer.from(xmpPacket, "utf8")]);
  const len = payload.length + 2; // length field includes its own 2 bytes
  const header = Buffer.from([0xff, 0xe1, (len >> 8) & 0xff, len & 0xff]);
  const segment = Buffer.concat([header, payload]);
  return Buffer.concat([jpeg.subarray(0, 2), segment, jpeg.subarray(2)]);
}

describe("extractMetadata", () => {
  it("surfaces standard photographic fields and curated keys", async () => {
    const jpeg = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#345" } })
      .withExif({
        IFD0: { Make: "Lumio", Model: "FixtureCam" },
        IFD2: {
          DateTimeOriginal: "2024:03:14 09:26:53",
          FNumber: "28/10",
          ISOSpeedRatings: "400",
          FocalLength: "50/1",
          LensModel: "Nifty Fifty",
        },
      })
      .jpeg()
      .toBuffer();

    const { exif, takenAt } = await extractMetadata(jpeg);

    // Full dump now includes fields that used to be discarded:
    expect(exif.FNumber).toBe(2.8);
    expect(exif.ISO).toBe(400);
    expect(exif.FocalLength).toBe(50);
    expect(exif.LensModel).toBe("Nifty Fifty");
    // Curated keys preserved for sort/smart-albums:
    expect(exif.cameraMake).toBe("Lumio");
    expect(exif.cameraModel).toBe("FixtureCam");
    expect(exif.takenAt).toBe("2024-03-14T09:26:53.000Z");
    expect(takenAt?.toISOString()).toBe("2024-03-14T09:26:53.000Z");
    // Dates inside the dump are sanitized to ISO strings:
    expect(exif.DateTimeOriginal).toBe("2024-03-14T09:26:53.000Z");
  });

  it("reads custom-namespace tags from embedded XMP (e.g. filmexif)", async () => {
    const base = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#888" } })
      .jpeg()
      .toBuffer();
    const xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:filmexif="http://filmexif.app/ns/1.0/"
    filmexif:FilmStock="Kodak Portra 400"
    filmexif:FilmISO="400"/>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
    const { exif } = await extractMetadata(embedXmp(base, xmp));
    expect(exif.FilmStock).toBe("Kodak Portra 400");
    expect(exif.FilmISO).toBe(400);
  });

  it("returns an empty object and null date for input with no metadata", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } })
      .png()
      .toBuffer();
    const { exif, takenAt } = await extractMetadata(png);
    expect(takenAt).toBeNull();
    expect(exif.takenAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TZ=UTC pnpm --filter @lumio/ingest exec vitest run src/metadata.test.ts`
Expected: FAIL — `extractMetadata is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `packages/ingest/src/metadata.ts`:

```ts
/** Every block exifr can read, merged into one flat object. */
const EXIFR_OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  xmp: true,
  iptc: true,
  jfif: true,
  ihdr: true,
  interop: true,
  mergeOutput: true,
};

function parseExifDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

/**
 * Read all available metadata from an image buffer. Returns the full sanitized
 * dump (with the curated keys overlaid) plus the parsed capture date.
 */
export async function extractMetadata(
  buffer: Buffer,
): Promise<{ exif: ExifData; takenAt: Date | null }> {
  const raw = ((await exifr.parse(buffer, EXIFR_OPTIONS).catch(() => null)) ?? {}) as Record<
    string,
    unknown
  >;
  const exif = sanitizeMetadata(raw) as ExifData;

  const takenAt = parseExifDate(raw.DateTimeOriginal ?? raw.CreateDate);
  const curated: ExifData = {
    takenAt: takenAt ? takenAt.toISOString() : undefined,
    cameraMake: typeof raw.Make === "string" ? raw.Make.trim() : undefined,
    cameraModel: typeof raw.Model === "string" ? raw.Model.trim() : undefined,
    orientation: typeof raw.Orientation === "number" ? raw.Orientation : undefined,
  };
  for (const [k, v] of Object.entries(curated)) {
    if (v !== undefined) exif[k] = v;
  }

  return { exif, takenAt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `TZ=UTC pnpm --filter @lumio/ingest exec vitest run src/metadata.test.ts`
Expected: PASS (all `sanitizeMetadata` + `extractMetadata` tests).

- [ ] **Step 5: Update the `ExifData` doc comment**

In `packages/shared/src/types.ts`, update the comment on the passthrough line of `ExifData` to reflect that it now holds the full dump. Replace:

```ts
  [key: string]: unknown; // raw passthrough allowed
```

with:

```ts
  [key: string]: unknown; // full sanitized metadata dump (all EXIF/GPS/XMP/IPTC tags)
```

(Structure is unchanged — the four curated fields and the index signature stay.)

- [ ] **Step 6: Commit**

```bash
git add packages/ingest/src/metadata.ts packages/ingest/src/metadata.test.ts packages/shared/src/types.ts
git commit -m "feat(ingest): extractMetadata reads all blocks incl. embedded XMP"
```

---

## Task 3: Route `process.ts` through `extractMetadata`

**Files:**
- Modify: `packages/ingest/src/process.ts` (imports + lines 31–38; remove local `parseExifDate`)
- Modify: `packages/ingest/src/process.test.ts` (fixture + assertions)

`processImage` keeps its shape; it just delegates EXIF work. Add a regression assertion that the richer fields now reach `result.exif`.

- [ ] **Step 1: Update the test first (extend the fixture + assert richer fields)**

In `packages/ingest/src/process.test.ts`, replace the fixture `withExif` block (lines 12–15) with:

```ts
  .withExif({
    IFD0: { Make: "Lumio", Model: "FixtureCam" },
    IFD2: {
      DateTimeOriginal: "2024:03:14 09:26:53",
      FNumber: "28/10",
      ISOSpeedRatings: "400",
      FocalLength: "50/1",
    },
  })
```

And add these assertions inside the first `it(...)` block, after the existing `cameraModel` assertion (line 30):

```ts
    expect(result.exif.FNumber).toBe(2.8);
    expect(result.exif.ISO).toBe(400);
    expect(result.exif.FocalLength).toBe(50);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/ingest test`
Expected: FAIL — `result.exif.FNumber` is `undefined` (process.ts still keeps only four fields).

- [ ] **Step 3: Edit `process.ts` to delegate**

In `packages/ingest/src/process.ts`:

Remove the `exifr` import (line 3) and add a metadata import. Replace line 3:

```ts
import exifr from "exifr";
```

with:

```ts
import { extractMetadata } from "./metadata.js";
```

Delete the local `parseExifDate` helper (lines 19–22):

```ts
function parseExifDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}
```

Replace the extraction block (lines 31–38):

```ts
    const raw = (await exifr.parse(original).catch(() => null)) ?? {};
    const takenAt = parseExifDate(raw.DateTimeOriginal ?? raw.CreateDate);
    const exif: ExifData = {
      takenAt: takenAt ? takenAt.toISOString() : undefined,
      cameraMake: typeof raw.Make === "string" ? raw.Make.trim() : undefined,
      cameraModel: typeof raw.Model === "string" ? raw.Model.trim() : undefined,
      orientation: typeof raw.Orientation === "number" ? raw.Orientation : undefined,
    };
```

with:

```ts
    const { exif, takenAt } = await extractMetadata(original);
```

(The `import type { ExifData }` on line 5 stays — `ProcessedPhoto.exif` still uses it.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @lumio/ingest test`
Expected: PASS — all `process.test.ts`, `metadata.test.ts`, and existing ingest tests green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @lumio/ingest typecheck`
Expected: no errors (confirms the removed `exifr`/`parseExifDate` references are all gone).

- [ ] **Step 6: Commit**

```bash
git add packages/ingest/src/process.ts packages/ingest/src/process.test.ts
git commit -m "refactor(ingest): processImage uses extractMetadata"
```

---

## Task 4: `exifEntries` — flatten metadata for display

**Files:**
- Create: `apps/web/src/lib/exif-entries.ts`
- Test: `apps/web/src/lib/exif-entries.test.ts`

Pure helper that turns `ExifData` into the alphabetically-sorted `[label, value]` rows the detail view dumps. Objects/arrays are JSON-stringified; empty/nullish values are dropped.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/exif-entries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { exifEntries, formatExifValue } from "./exif-entries";

describe("formatExifValue", () => {
  it("passes strings through and stringifies scalars", () => {
    expect(formatExifValue("Nikon")).toBe("Nikon");
    expect(formatExifValue(2.8)).toBe("2.8");
    expect(formatExifValue(true)).toBe("true");
  });

  it("JSON-stringifies objects and arrays", () => {
    expect(formatExifValue([1, 2])).toBe("[1,2]");
    expect(formatExifValue({ lat: 1 })).toBe('{"lat":1}');
  });
});

describe("exifEntries", () => {
  it("returns entries sorted by key, dropping empty values", () => {
    const rows = exifEntries({
      Model: "FixtureCam",
      FNumber: 2.8,
      cameraMake: "",
      orientation: undefined,
      ISO: 400,
    });
    expect(rows).toEqual([
      ["FNumber", "2.8"],
      ["ISO", "400"],
      ["Model", "FixtureCam"],
    ]);
  });

  it("returns an empty array for empty metadata", () => {
    expect(exifEntries({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/exif-entries.test.ts`
Expected: FAIL — cannot resolve `./exif-entries`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/exif-entries.ts`:

```ts
import type { ExifData } from "@lumio/shared";

export function formatExifValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Flatten EXIF into sorted [key, value] pairs for the full metadata dump. */
export function exifEntries(exif: ExifData): Array<[string, string]> {
  return Object.entries(exif)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, formatExifValue(v)] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/exif-entries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/exif-entries.ts apps/web/src/lib/exif-entries.test.ts
git commit -m "feat(web): exifEntries helper for full metadata display"
```

---

## Task 5: Render the full key/value dump in photo detail

**Files:**
- Modify: `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx` (import + lines 118–125)

Replace the raw `JSON.stringify` block with a definition list of every metadata entry. No unit test (the page renders in a `node`-env test setup with no DOM); the logic is covered by Task 4 and this is browser-verified.

- [ ] **Step 1: Add the import**

In `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx`, after the existing `photo-href` import (line 12), add:

```ts
import { exifEntries } from "@/lib/exif-entries";
```

- [ ] **Step 2: Compute the rows once in the component body**

Immediately after the `camera` const (ends line 35), add:

```ts
  const metadata = exifEntries(photo.exif);
```

- [ ] **Step 3: Replace the `<details>` block (lines 118–125)**

Replace:

```tsx
        <details className="group">
          <summary className="cursor-pointer text-muted-foreground select-none">
            Show all EXIF
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(photo.exif, null, 2)}
          </pre>
        </details>
```

with:

```tsx
        <details className="group">
          <summary className="cursor-pointer text-muted-foreground select-none">
            Show all metadata
          </summary>
          {metadata.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No metadata</p>
          ) : (
            <dl className="mt-2 space-y-1 text-xs">
              {metadata.map(([key, value]) => (
                <div key={key} className="flex justify-between gap-3">
                  <dt className="shrink-0 text-muted-foreground">{key}</dt>
                  <dd className="min-w-0 break-all text-right font-mono">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </details>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Browser-verify**

Start the app (`pnpm dev`), open a photo with rich EXIF (e.g. a recent upload), expand **Show all metadata**, and confirm a sorted key/value list with fields like `FNumber`, `ISO`, `FocalLength`, plus camera/date keys. (filmexif-embedded photos should also show `FilmStock` etc.)

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(app)/photo/[id]/photo-detail.tsx"
git commit -m "feat(web): dump full metadata as key/value list in photo detail"
```

---

## Task 6: `upload-collect` — folder traversal + supported filter

**Files:**
- Create: `apps/web/src/lib/upload-collect.ts`
- Test: `apps/web/src/lib/upload-collect.test.ts`

The folder recursion is written against a minimal `FsEntry` shape so it is testable without a browser. `partitionSupported` filters out unsupported files (RAW/`.xmp`/etc.) using the shared `SUPPORTED_EXTENSIONS`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/upload-collect.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { collectFromEntries, isSupported, partitionSupported, type FsEntry } from "./upload-collect";

function fileEntry(name: string): FsEntry {
  return { isFile: true, isDirectory: false, file: (cb) => cb(new File([name], name)) };
}
function dirEntry(children: FsEntry[]): FsEntry {
  let handed = false;
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (cb) => {
        // First call returns the children, subsequent call signals "drained".
        if (handed) return cb([]);
        handed = true;
        cb(children);
      },
    }),
  };
}

describe("isSupported", () => {
  it("accepts known image extensions, rejects others", () => {
    expect(isSupported("IMG.JPG")).toBe(true);
    expect(isSupported("scan.heic")).toBe(true);
    expect(isSupported("IMG.jpg.xmp")).toBe(false);
    expect(isSupported("raw.dng")).toBe(false);
    expect(isSupported("noext")).toBe(false);
  });
});

describe("partitionSupported", () => {
  it("splits supported files from skipped count", () => {
    const files = [new File(["a"], "a.jpg"), new File(["b"], "b.xmp"), new File(["c"], "c.dng")];
    const { supported, skipped } = partitionSupported(files);
    expect(supported.map((f) => f.name)).toEqual(["a.jpg"]);
    expect(skipped).toBe(2);
  });
});

describe("collectFromEntries", () => {
  it("recursively flattens files from nested directories", async () => {
    const tree: FsEntry[] = [
      fileEntry("top.jpg"),
      dirEntry([fileEntry("a.jpg"), dirEntry([fileEntry("deep.png")])]),
    ];
    const files = await collectFromEntries(tree);
    expect(files.map((f) => f.name).sort()).toEqual(["a.jpg", "deep.png", "top.jpg"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/upload-collect.test.ts`
Expected: FAIL — cannot resolve `./upload-collect`.

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/lib/upload-collect.ts`:

```ts
import { SUPPORTED_EXTENSIONS } from "@lumio/ingest";

/** A directory reader; yields children in batches until an empty batch. */
export interface EntryReader {
  readEntries: (onEntries: (entries: FsEntry[]) => void, onErr?: (e: unknown) => void) => void;
}

/** Minimal subset of the browser FileSystemEntry API we rely on (kept small so it's testable). */
export interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  file?: (onFile: (f: File) => void, onErr?: (e: unknown) => void) => void;
  createReader?: () => EntryReader;
}

export function isSupported(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  return SUPPORTED_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

export function partitionSupported(files: File[]): { supported: File[]; skipped: number } {
  const supported = files.filter((f) => isSupported(f.name));
  return { supported, skipped: files.length - supported.length };
}

function entryToFile(entry: FsEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file!(resolve, reject));
}

/** readEntries yields children in batches; call until it returns an empty batch. */
function readAllEntries(reader: EntryReader): Promise<FsEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FsEntry[] = [];
    const pump = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          pump();
        }
      }, reject);
    pump();
  });
}

export async function collectFromEntries(entries: FsEntry[]): Promise<File[]> {
  const files: File[] = [];
  for (const entry of entries) {
    if (entry.isFile && entry.file) {
      files.push(await entryToFile(entry));
    } else if (entry.isDirectory && entry.createReader) {
      const children = await readAllEntries(entry.createReader());
      files.push(...(await collectFromEntries(children)));
    }
  }
  return files;
}

/**
 * Flatten a drop's DataTransfer into a File[]. Captures directory entries
 * synchronously (they expire once the drop event returns), then traverses.
 * Falls back to `dataTransfer.files` when the entries API is unavailable.
 */
export async function collectFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .map((it) => (typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null) as unknown as FsEntry[];
  if (entries.length > 0) return collectFromEntries(entries);
  return Array.from(dataTransfer.files ?? []);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/upload-collect.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/upload-collect.ts apps/web/src/lib/upload-collect.test.ts
git commit -m "feat(web): folder traversal + supported-extension filter for uploads"
```

---

## Task 7: Wire folder drop + picker + skipped count into the Upload page

**Files:**
- Modify: `apps/web/src/app/(app)/upload/upload-client.tsx`

Drops now recurse folders; a "folder" picker uses `webkitdirectory`; unsupported files are filtered before queueing and reported as a skipped count. The pure logic is covered by Task 6; this UI wiring is browser-verified.

- [ ] **Step 1: Add imports + a folder input ref + skipped state**

In `apps/web/src/app/(app)/upload/upload-client.tsx`, after the `cn` import (line 6) add:

```ts
import { collectFiles, partitionSupported } from "@/lib/upload-collect";
```

Inside `UploadClient`, after `const inputRef = useRef<HTMLInputElement>(null);` (line 32) add:

```ts
  const folderInputRef = useRef<HTMLInputElement>(null);
```

After `const [dragging, setDragging] = useState(false);` (line 34) add:

```ts
  const [skipped, setSkipped] = useState(0);
```

- [ ] **Step 2: Filter unsupported inside `addFiles`**

Replace the start of `addFiles` (lines 57–59):

```ts
  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
```

with:

```ts
  const addFiles = useCallback(
    async (incoming: File[]) => {
      const { supported: files, skipped: nSkipped } = partitionSupported(incoming);
      if (nSkipped > 0) setSkipped((n) => n + nSkipped);
      if (files.length === 0) return;
```

(The rest of `addFiles` already operates on `files` — no further change in its body.)

- [ ] **Step 3: Use `collectFiles` in the drop handler**

Replace the `onDrop` handler (lines 93–97):

```tsx
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(Array.from(e.dataTransfer.files));
        }}
```

with:

```tsx
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void collectFiles(e.dataTransfer).then(addFiles);
        }}
```

- [ ] **Step 4: Update the helper text**

Replace the drop-zone caption (lines 104–106):

```tsx
        <span className="text-sm text-muted-foreground">
          Drag photos here, or click to choose files
        </span>
```

with:

```tsx
        <span className="text-sm text-muted-foreground">
          Drag photos or a folder here, or click to choose files
        </span>
```

- [ ] **Step 5: Add the folder picker input + a "choose a folder" affordance**

Immediately after the existing file `<input>` (closes line 119), add the folder input and a button row:

```tsx
      <input
        ref={folderInputRef}
        type="file"
        // @ts-expect-error - non-standard but widely supported directory upload attrs
        webkitdirectory=""
        directory=""
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Or upload a whole folder
        </button>
      </div>
```

- [ ] **Step 6: Show the skipped count above the rows**

Immediately before the `{rows.length > 0 && (` block (line 121), add:

```tsx
      {skipped > 0 && (
        <p className="text-sm text-muted-foreground">
          Skipped {skipped} unsupported file{skipped === 1 ? "" : "s"}.
        </p>
      )}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Browser-verify**

Run `pnpm dev`. On `/upload`:
1. Drag a **folder** containing a mix of images + a `.xmp`/`.txt`/RAW onto the zone → only the supported images queue and upload; a "Skipped N unsupported files" line appears.
2. Click **Or upload a whole folder**, pick a nested folder → images from subfolders are uploaded.
3. Confirm dropped/added photos appear in `/photos` and their detail view shows the full metadata dump (Task 5).

- [ ] **Step 9: Commit**

```bash
git add "apps/web/src/app/(app)/upload/upload-client.tsx"
git commit -m "feat(web): recursive folder upload, skip unsupported files"
```

---

## Final verification

- [ ] **Run the full test suite**

Run: `pnpm test`
Expected: all packages green (ingest incl. new `metadata.test.ts`; web incl. `exif-entries.test.ts` + `upload-collect.test.ts`; worker unchanged).

- [ ] **Backfill existing photos**

Restart the worker so `scanAndIngest()` re-processes `PHOTOS_DIR` and rewrites each `Photo.exif` with the richer blob:

Run: `pnpm watch` (or restart the deployed worker)
Expected: existing photos' detail views now show the full metadata dump.

---

## Notes / gotchas

- **Tests must run under `TZ=UTC`** for date assertions to hold (`@lumio/ingest`'s `test` script already sets it; the per-file commands above prepend it). The `09:26:53.000Z` expectations assume UTC.
- **`webkitGetAsEntry` entries expire** once the drop event handler returns — `collectFiles` captures them synchronously before any `await`, so always call `collectFiles(e.dataTransfer)` directly inside `onDrop` (never after an `await`).
- **No DB migration**; `Photo.exif` is already `Json`/JSONB. Smart-album filtering on `exif.cameraModel` and sorting on `takenAt` keep working because the curated keys are preserved.
- **Sidecar `.xmp`, RAW/TIFF formats, and per-block namespacing are out of scope** (see spec Non-goals); a stray `.xmp` is simply skipped on upload.
