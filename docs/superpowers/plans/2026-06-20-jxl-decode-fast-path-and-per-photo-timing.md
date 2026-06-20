# JXL Decode Fast-Path + Per-Photo Timing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.jxl` ingest ~8× faster by piping `djxl` raw pixels straight to Sharp (no temp PNG, single decode), and log how long each photo takes.

**Architecture:** `decode.ts` gains a JXL branch that spawns `djxl … --output_format pam`, parses the tiny PAM header, and hands the raw pixel buffer to Sharp via `{ raw }`. `process.ts` decodes once and derives both renditions (JXL from the in-memory raw buffer; native/HEIC by deriving the thumbnail from the display buffer). The worker logs a per-photo timing line in scan and watch modes.

**Tech Stack:** TypeScript (ESM), Node 24, Sharp/libvips, `djxl` (libjxl-tools, already in the Docker image), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-20-jxl-decode-fast-path-and-worker-logging-design.md`

---

## File Structure

- `packages/ingest/src/decode.ts` — **modify**: add `parsePAM`, `decodeJxlToRaw`, `decodeToSharpInput` (+`DecodedInput`); remove `decodeToReadable`/`Decoded` and the `.jxl` entry in `CONVERTERS` (HEIC keeps using it).
- `packages/ingest/src/decode.test.ts` — **modify**: drop `decodeToReadable` tests; test `parsePAM`, `decodeJxlToRaw` (gated on tools), and `decodeToSharpInput` dispatch.
- `packages/ingest/src/process.ts` — **modify**: consume `decodeToSharpInput`; decode-once branches.
- `packages/ingest/src/process.test.ts` — **modify**: add a JXL integration test and an orientation regression test (both gated on `cjxl`+`djxl`).
- `apps/worker/src/format.ts` — **create**: pure `timedLine(relPath, ms)` formatter shared by scan + watch.
- `apps/worker/src/format.test.ts` — **create**: unit tests for `timedLine`.
- `apps/worker/src/scan.ts` — **modify**: per-photo timing log on success.
- `apps/worker/src/watch.ts` — **modify**: append timing to the `+ rel` event line.

**Test commands:**
- ingest: `pnpm --filter @lumio/ingest test`
- worker: `pnpm --filter @lumio/worker test`
- single file: `pnpm --filter @lumio/ingest exec vitest run src/decode.test.ts`

---

## Task 1: `parsePAM` header parser

**Files:**
- Modify: `packages/ingest/src/decode.ts`
- Test: `packages/ingest/src/decode.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/ingest/src/decode.test.ts` (and add `parsePAM` to the import on line 6: `import { decodeToReadable, CONVERTERS, NATIVE_EXTENSIONS, parsePAM } from "./decode.js";`):

```ts
describe("parsePAM", () => {
  it("reads WIDTH/HEIGHT/DEPTH and the body offset for RGB", () => {
    const header = "P7\nWIDTH 2\nHEIGHT 3\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n";
    const body = Buffer.alloc(2 * 3 * 3, 7);
    const pam = Buffer.concat([Buffer.from(header, "ascii"), body]);

    const h = parsePAM(pam);
    expect(h.width).toBe(2);
    expect(h.height).toBe(3);
    expect(h.channels).toBe(3);
    expect(pam.subarray(h.offset).length).toBe(body.length);
  });

  it("reads DEPTH 4 for RGBA", () => {
    const header = "P7\nWIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n";
    const pam = Buffer.concat([Buffer.from(header, "ascii"), Buffer.alloc(4)]);
    expect(parsePAM(pam).channels).toBe(4);
  });

  it("throws on a buffer with no PAM header", () => {
    expect(() => parsePAM(Buffer.from("not a pam"))).toThrow("invalid PAM");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/ingest exec vitest run src/decode.test.ts -t parsePAM`
Expected: FAIL — `parsePAM is not a function` / import error.

- [ ] **Step 3: Implement `parsePAM`**

Add to `packages/ingest/src/decode.ts` (after the imports, near the top):

```ts
export interface PamHeader {
  width: number;
  height: number;
  /** Channel count from PAM DEPTH: 1 gray, 3 RGB, 4 RGBA. */
  channels: number;
  /** Byte offset where the raw pixel body begins (just past `ENDHDR\n`). */
  offset: number;
}

/**
 * Parse a binary PAM (`P7`) header — the format `djxl --output_format pam`
 * emits. The header is ASCII `KEY VALUE` lines terminated by `ENDHDR\n`;
 * raw pixels follow immediately.
 */
export function parsePAM(buf: Buffer): PamHeader {
  const marker = "ENDHDR\n";
  const end = buf.indexOf(marker);
  if (end === -1) throw new Error("invalid PAM: no ENDHDR marker");
  const header = buf.toString("ascii", 0, end).split("\n");
  const field = (key: string): number => {
    const line = header.find((l) => l.startsWith(key));
    if (!line) throw new Error(`invalid PAM: missing ${key}`);
    return Number(line.split(/\s+/)[1]);
  };
  return {
    width: field("WIDTH"),
    height: field("HEIGHT"),
    channels: field("DEPTH"),
    offset: end + marker.length,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/ingest exec vitest run src/decode.test.ts -t parsePAM`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/decode.ts packages/ingest/src/decode.test.ts
git commit -m "feat(ingest): parse PAM headers from djxl output"
```

---

## Task 2: `decodeJxlToRaw` — pipe `djxl` PAM to a raw buffer

**Files:**
- Modify: `packages/ingest/src/decode.ts`
- Test: `packages/ingest/src/decode.test.ts`

- [ ] **Step 1: Write the failing test**

At the TOP of `packages/ingest/src/decode.test.ts`, after the existing imports, add a tool-availability gate and helpers (these are reused in later tasks):

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);

async function hasBin(bin: string): Promise<boolean> {
  try { await execFileAsync("which", [bin]); return true; } catch { return false; }
}
/** JXL tests need cjxl (to build a fixture) and djxl (to decode it). */
const JXL_TOOLS = (await hasBin("cjxl")) && (await hasBin("djxl"));

/** Write a solid-colour PNG, then losslessly transcode it to a .jxl fixture. */
async function makeJxl(srcPng: string, outJxl: string, w: number, h: number): Promise<void> {
  await sharp({ create: { width: w, height: h, channels: 3, background: "#3366aa" } })
    .png()
    .toFile(srcPng);
  await execFileAsync("cjxl", [srcPng, outJxl, "-q", "90"]);
}
```

Then add (it needs `decodeJxlToRaw` in the import on line 6):

```ts
describe.skipIf(!JXL_TOOLS)("decodeJxlToRaw", () => {
  it("returns a raw RGB buffer sized width*height*channels", async () => {
    const src = path.join(dir, "raw-src.png");
    const jxl = path.join(dir, "raw.jxl");
    await makeJxl(src, jxl, 40, 24);

    const raw = await decodeJxlToRaw(jxl);
    expect(raw.width).toBe(40);
    expect(raw.height).toBe(24);
    expect(raw.channels).toBe(3);
    expect(raw.buffer.length).toBe(40 * 24 * 3);

    // The raw buffer is sharp-readable and re-encodes to the expected size.
    const meta = await sharp(raw.buffer, { raw: { width: 40, height: 24, channels: 3 } })
      .webp()
      .toBuffer()
      .then((b) => sharp(b).metadata());
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(24);
  });

  it("rejects when djxl cannot decode the input", async () => {
    const bad = path.join(dir, "bad.jxl");
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } })
      .png()
      .toFile(bad); // a PNG with a .jxl name — djxl should fail
    await expect(decodeJxlToRaw(bad)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/ingest exec vitest run src/decode.test.ts -t decodeJxlToRaw`
Expected: FAIL — `decodeJxlToRaw is not a function`. (If `cjxl`/`djxl` are absent, the suite is skipped — install `libjxl-tools` to run it; CI without the binaries stays green by design.)

- [ ] **Step 3: Implement `decodeJxlToRaw`**

Add `spawn` to the existing `node:child_process` import in `decode.ts`:

```ts
import { execFile, spawn } from "node:child_process";
```

Then add:

```ts
export interface RawImage {
  buffer: Buffer;
  width: number;
  height: number;
  channels: number;
}

/** Run `djxl <path> - --output_format pam` and collect stdout. */
function runDjxlPam(absPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("djxl", [absPath, "-", "--output_format", "pam"]);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", () => {}); // djxl logs progress to stderr; ignore
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`djxl exited ${code}`)),
    );
  });
}

/**
 * Decode a JXL to raw pixels in memory by piping `djxl` PAM output to stdout —
 * no temp file, no PNG re-encode. djxl bakes EXIF orientation into the pixels,
 * so the result is already upright (no Sharp `.rotate()` needed downstream).
 */
export async function decodeJxlToRaw(absPath: string): Promise<RawImage> {
  const pam = await runDjxlPam(absPath);
  const { width, height, channels, offset } = parsePAM(pam);
  return { buffer: pam.subarray(offset), width, height, channels };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/ingest exec vitest run src/decode.test.ts -t decodeJxlToRaw`
Expected: PASS (2 tests), assuming `cjxl`/`djxl` are installed.

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/decode.ts packages/ingest/src/decode.test.ts
git commit -m "feat(ingest): decode JXL to raw pixels via djxl PAM pipe"
```

---

## Task 3: `decodeToSharpInput` dispatcher (replaces `decodeToReadable`)

**Files:**
- Modify: `packages/ingest/src/decode.ts`
- Test: `packages/ingest/src/decode.test.ts`

- [ ] **Step 1: Write the failing test**

In `packages/ingest/src/decode.test.ts`, **replace** the entire `describe("decodeToReadable", …)` block with this `decodeToSharpInput` block, and update the import on line 6 to drop `decodeToReadable` and add `decodeToSharpInput` (final import: `import { decodeToSharpInput, decodeJxlToRaw, parsePAM, CONVERTERS, NATIVE_EXTENSIONS } from "./decode.js";`):

```ts
describe("decodeToSharpInput", () => {
  it("native passthrough: returns the original path, rotate:true, no temp", async () => {
    const tmpPng = path.join(dir, "fixture.png");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ff0000" } })
      .png()
      .toFile(tmpPng);

    const decoded = await decodeToSharpInput(tmpPng);
    expect(decoded.input).toBe(tmpPng);
    expect(decoded.raw).toBeUndefined();
    expect(decoded.rotate).toBe(true);

    await decoded.cleanup();
    const s = await stat(tmpPng);
    expect(s.isFile()).toBe(true); // cleanup is a no-op for native
  });

  it("rejects with 'no external decoder available' for unknown extensions", async () => {
    await expect(decodeToSharpInput("/tmp/whatever.xyz")).rejects.toThrow(
      "no external decoder available",
    );
  });

  it.skipIf(!JXL_TOOLS)("jxl: returns a raw buffer with dims and rotate:false", async () => {
    const src = path.join(dir, "dispatch-src.png");
    const jxl = path.join(dir, "dispatch.jxl");
    await makeJxl(src, jxl, 32, 20);

    const decoded = await decodeToSharpInput(jxl);
    expect(Buffer.isBuffer(decoded.input)).toBe(true);
    expect(decoded.raw).toEqual({ width: 32, height: 20, channels: 3 });
    expect(decoded.rotate).toBe(false);
  });
});
```

Also **update** the existing `NATIVE_EXTENSIONS` test (it stays) and **remove** the now-obsolete test `it("CONVERTERS has djxl as first candidate for .jxl", …)` — `.jxl` no longer lives in `CONVERTERS`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/ingest exec vitest run src/decode.test.ts -t decodeToSharpInput`
Expected: FAIL — `decodeToSharpInput is not a function`.

- [ ] **Step 3: Implement `decodeToSharpInput` and remove the old API**

In `decode.ts`: **delete** the `.jxl` entry from `CONVERTERS` (keep `.heic`/`.heif`), **delete** the old `Decoded` interface and `decodeToReadable` function, and add:

```ts
export interface DecodedInput {
  /** Sharp input: the original path (native), a raw pixel buffer (JXL), or a temp PNG path (HEIC). */
  input: string | Buffer;
  /** Present iff `input` is raw pixels → caller passes sharp(input, { raw }). */
  raw?: { width: number; height: number; channels: number };
  /** Whether Sharp must apply EXIF orientation. False for already-upright pixels (JXL/HEIC). */
  rotate: boolean;
  /** Remove any temp artifacts (HEIC temp PNG). No-op for native/JXL. */
  cleanup: () => Promise<void>;
}

/**
 * Return a Sharp-ready input for `absPath`:
 *  - native formats pass the path straight through (rotate via EXIF),
 *  - `.jxl` is piped through djxl into a raw pixel buffer (already upright),
 *  - HEIC/HEIF are converted to a temp PNG via an external tool (with cleanup).
 * Throws if a non-native format has no installed decoder.
 */
export async function decodeToSharpInput(absPath: string): Promise<DecodedInput> {
  const ext = path.extname(absPath).toLowerCase();
  if (NATIVE_EXTENSIONS.has(ext)) {
    return { input: absPath, rotate: true, cleanup: async () => {} };
  }
  if (ext === ".jxl") {
    const { buffer, width, height, channels } = await decodeJxlToRaw(absPath);
    return { input: buffer, raw: { width, height, channels }, rotate: false, cleanup: async () => {} };
  }
  const converter = await resolveConverter(ext);
  if (!converter) {
    throw new Error(`no external decoder available for ${ext}`);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "lumio-decode-"));
  const out = path.join(dir, "decoded.png");
  try {
    await execFileAsync(converter.bin, converter.args(absPath, out));
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  return {
    input: out,
    rotate: true,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
```

(Leave `NATIVE_EXTENSIONS`, `CONVERTERS`, `onPath`, `resolveConverter`, and the `execFileAsync`/`mkdtemp`/`rm`/`tmpdir` imports in place — HEIC still uses them.)

- [ ] **Step 4: Run the decode tests**

Run: `pnpm --filter @lumio/ingest exec vitest run src/decode.test.ts`
Expected: PASS (parsePAM + decodeJxlToRaw + decodeToSharpInput + NATIVE_EXTENSIONS). `process.test.ts` will not compile yet — that's Task 4. Verify the type error is only in `process.ts` referencing `decodeToReadable`:

Run: `pnpm --filter @lumio/ingest typecheck`
Expected: error in `process.ts` (`decodeToReadable` not exported). Fixed next task.

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/decode.ts packages/ingest/src/decode.test.ts
git commit -m "feat(ingest): decodeToSharpInput dispatcher (native/jxl/heic)"
```

---

## Task 4: `process.ts` decode-once + derive both renditions

**Files:**
- Modify: `packages/ingest/src/process.ts`
- Test: `packages/ingest/src/process.test.ts` (existing tests must stay green)

- [ ] **Step 1: Run existing process tests to confirm the current green baseline expectation**

Run: `pnpm --filter @lumio/ingest exec vitest run src/process.test.ts`
Expected: currently FAILS to compile (Task 3 removed `decodeToReadable`). This task makes it pass again.

- [ ] **Step 2: Rewrite `process.ts`**

Replace the body of `packages/ingest/src/process.ts` with:

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractMetadata } from "./metadata.js";
import sharp from "sharp";
import type { ExifData } from "@lumio/shared";
import { DISPLAY_MAX, THUMBNAIL_MAX } from "./constants.js";
import { decodeToSharpInput } from "./decode.js";
import { computeThumbhash } from "./thumbhash.js";

export interface ProcessedPhoto {
  width: number;
  height: number;
  takenAt: Date | null;
  hash: string;
  thumbhash: string;
  exif: ExifData;
  thumbnail: Buffer;
  display: Buffer;
}

const FIT = { fit: "inside", withoutEnlargement: true } as const;

/** Read an image and derive everything the store layer needs. No DB or FS writes. */
export async function processImage(absPath: string): Promise<ProcessedPhoto> {
  const original = await readFile(absPath); // for hash + EXIF (original format)
  const decoded = await decodeToSharpInput(absPath);
  try {
    const { exif, takenAt } = await extractMetadata(original);

    let width: number;
    let height: number;
    let display: Buffer;
    let thumbnail: Buffer;

    if (decoded.raw) {
      // JXL: pixels are already decoded in memory, so re-wrapping the buffer
      // costs no decode — derive BOTH renditions from full-quality raw.
      const { width: w, height: h, channels } = decoded.raw;
      const buf = decoded.input as Buffer;
      const src = () => sharp(buf, { raw: { width: w, height: h, channels } });
      width = w;
      height = h;
      display = await src().resize(DISPLAY_MAX, DISPLAY_MAX, FIT).webp({ quality: 80 }).toBuffer();
      thumbnail = await src().resize(THUMBNAIL_MAX, THUMBNAIL_MAX, FIT).webp({ quality: 80 }).toBuffer();
    } else {
      // native / HEIC temp PNG: decode once for the display, then derive the
      // thumbnail from that buffer (one full decode instead of two).
      const meta = await sharp(decoded.input).metadata();
      width = meta.width ?? 0;
      height = meta.height ?? 0;
      const pipe = sharp(decoded.input);
      if (decoded.rotate) pipe.rotate();
      display = await pipe.resize(DISPLAY_MAX, DISPLAY_MAX, FIT).webp({ quality: 80 }).toBuffer();
      thumbnail = await sharp(display).resize(THUMBNAIL_MAX, THUMBNAIL_MAX, FIT).webp({ quality: 80 }).toBuffer();
    }

    const thumbhash = await computeThumbhash(thumbnail);
    const hash = createHash("sha256").update(original).digest("hex");

    return { width, height, takenAt, hash, thumbhash, exif, thumbnail, display };
  } finally {
    await decoded.cleanup();
  }
}
```

- [ ] **Step 3: Run existing process tests to verify they pass again**

Run: `pnpm --filter @lumio/ingest exec vitest run src/process.test.ts`
Expected: PASS (the 3 existing native tests — dims/EXIF/thumbnail, display cap at 2048, null takenAt).

- [ ] **Step 4: Typecheck the package**

Run: `pnpm --filter @lumio/ingest typecheck`
Expected: PASS (no more `decodeToReadable` reference).

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/process.ts
git commit -m "perf(ingest): decode once, derive both renditions (JXL from raw)"
```

---

## Task 5: JXL + orientation integration tests for `processImage`

**Files:**
- Test: `packages/ingest/src/process.test.ts`

- [ ] **Step 1: Write the failing tests**

At the top of `packages/ingest/src/process.test.ts`, add the tool gate + JXL fixture helper (after the existing imports):

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
async function hasBin(bin: string): Promise<boolean> {
  try { await execFileAsync("which", [bin]); return true; } catch { return false; }
}
const JXL_TOOLS = (await hasBin("cjxl")) && (await hasBin("djxl"));
```

Then add a new describe block:

```ts
describe.skipIf(!JXL_TOOLS)("processImage — JXL", () => {
  it("decodes a .jxl into thumbnail + display + thumbhash with correct dims", async () => {
    const src = path.join(dir, "jxl-src.png");
    const jxl = path.join(dir, "photo.jxl");
    await sharp({ create: { width: 300, height: 200, channels: 3, background: "#779988" } })
      .png()
      .toFile(src);
    await execFileAsync("cjxl", [src, jxl, "-q", "90"]);

    const result = await processImage(jxl);

    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
    expect(result.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.thumbhash.length).toBeGreaterThan(0);

    const thumbMeta = await sharp(result.thumbnail).metadata();
    expect(thumbMeta.format).toBe("webp");
    expect(Math.max(thumbMeta.width ?? 0, thumbMeta.height ?? 0)).toBeLessThanOrEqual(400);

    const dispMeta = await sharp(result.display).metadata();
    expect(dispMeta.format).toBe("webp");
  });

  it("applies EXIF orientation (djxl bakes it) — a rotated source decodes upright", async () => {
    // Source is 400x200 tagged orientation=6 (90° CW) → should present as 200x400.
    const src = path.join(dir, "oriented-src.jpg");
    const jxl = path.join(dir, "oriented.jxl");
    await sharp({ create: { width: 400, height: 200, channels: 3, background: "#445566" } })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(src);
    await execFileAsync("cjxl", [src, jxl, "--lossless_jpeg=1"]);

    const result = await processImage(jxl);
    expect(result.width).toBe(200);
    expect(result.height).toBe(400);
  });
});
```

- [ ] **Step 2: Run the new tests to verify they pass**

Run: `pnpm --filter @lumio/ingest exec vitest run src/process.test.ts -t "JXL"`
Expected: PASS (2 tests) when `cjxl`/`djxl` are installed; SKIPPED otherwise.

- [ ] **Step 3: Run the full ingest suite**

Run: `pnpm --filter @lumio/ingest test`
Expected: PASS (all ingest tests).

- [ ] **Step 4: Commit**

```bash
git add packages/ingest/src/process.test.ts
git commit -m "test(ingest): JXL processImage + orientation regression"
```

---

## Task 6: `timedLine` per-photo log formatter

**Files:**
- Create: `apps/worker/src/format.ts`
- Test: `apps/worker/src/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/worker/src/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { timedLine } from "./format.js";

describe("timedLine", () => {
  it("appends the lowercased extension and rounded milliseconds", () => {
    expect(timedLine("2024/DCM_5868.NEF.jxl", 417.6)).toBe("2024/DCM_5868.NEF.jxl (.jxl) 418ms");
  });

  it("lowercases the extension and rounds down sub-half ms", () => {
    expect(timedLine("a/b.JPG", 12.2)).toBe("a/b.JPG (.jpg) 12ms");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/worker exec vitest run src/format.test.ts`
Expected: FAIL — cannot find module `./format.js`.

- [ ] **Step 3: Implement `timedLine`**

Create `apps/worker/src/format.ts`:

```ts
import path from "node:path";

/**
 * Per-photo timing suffix shared by the scan and watch logs, e.g.
 * `2024/IMG.NEF.jxl (.jxl) 418ms`. The extension flags the heavy `.jxl`
 * files at a glance.
 */
export function timedLine(relPath: string, ms: number): string {
  return `${relPath} (${path.extname(relPath).toLowerCase()}) ${Math.round(ms)}ms`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/worker exec vitest run src/format.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/format.ts apps/worker/src/format.test.ts
git commit -m "feat(worker): timedLine per-photo log formatter"
```

---

## Task 7: Log per-photo timing in scan mode

**Files:**
- Modify: `apps/worker/src/scan.ts`

- [ ] **Step 1: Add the import**

At the top of `apps/worker/src/scan.ts`, add:

```ts
import { performance } from "node:perf_hooks";
import { timedLine } from "./format.js";
```

- [ ] **Step 2: Time and log each processed photo**

In `scanAndIngest`, replace the success branch of the per-file pool task:

```ts
      if (isUnchanged(row, st, cacheExists)) {
        summary.skippedUnchanged++;
        return;
      }
      await ingestPath(relPath, ingestDeps);
      summary.processed++;
```

with:

```ts
      if (isUnchanged(row, st, cacheExists)) {
        summary.skippedUnchanged++;
        return;
      }
      const start = performance.now();
      await ingestPath(relPath, ingestDeps);
      summary.processed++;
      console.log(`processed ${timedLine(relPath, performance.now() - start)}`);
```

- [ ] **Step 3: Typecheck + run worker tests**

Run: `pnpm --filter @lumio/worker typecheck && pnpm --filter @lumio/worker test`
Expected: PASS (existing `scan.test.ts` pure-function tests unaffected; new `format.test.ts` passes).

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/scan.ts
git commit -m "feat(worker): log per-photo ingest time during scan"
```

---

## Task 8: Log per-photo timing in watch mode

**Files:**
- Modify: `apps/worker/src/watch.ts`

- [ ] **Step 1: Add the import**

At the top of `apps/worker/src/watch.ts`, add:

```ts
import { performance } from "node:perf_hooks";
import { timedLine } from "./format.js";
```

- [ ] **Step 2: Time and log each upserted photo**

In `watchAndIngest`, replace the `upsert` body:

```ts
  const upsert = async (abs: string): Promise<void> => {
    if (!isSupported(abs)) return;
    const rel = path.relative(PHOTOS_DIR, abs);
    try {
      await ingestPath(rel, ingestDeps);
      console.log(`+ ${rel}`);
    } catch (err) {
      console.warn(`skip ${rel}: ${(err as Error).message}`);
    }
  };
```

with:

```ts
  const upsert = async (abs: string): Promise<void> => {
    if (!isSupported(abs)) return;
    const rel = path.relative(PHOTOS_DIR, abs);
    try {
      const start = performance.now();
      await ingestPath(rel, ingestDeps);
      console.log(`+ ${timedLine(rel, performance.now() - start)}`);
    } catch (err) {
      console.warn(`skip ${rel}: ${(err as Error).message}`);
    }
  };
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lumio/worker typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/watch.ts
git commit -m "feat(worker): log per-photo ingest time in watch mode"
```

---

## Task 9: Full verification

- [ ] **Step 1: Run all package tests**

Run: `pnpm --filter @lumio/ingest test && pnpm --filter @lumio/worker test`
Expected: PASS across both packages.

- [ ] **Step 2: Typecheck both packages**

Run: `pnpm --filter @lumio/ingest typecheck && pnpm --filter @lumio/worker typecheck`
Expected: PASS.

- [ ] **Step 3: Measure the real win on the deploy hardware**

On the N100 worker container (which has `djxl` via `libjxl-tools`), with a few `.jxl` files under `PHOTOS_DIR`:

Run: `pnpm bench`
Expected: the `by format: .jxl …` row drops dramatically vs. the previous run (target ~8× lower ms for `.jxl`); the warmup is far below the previous ~114 s.

- [ ] **Step 4: Optional manual watch sanity check**

Run the worker (`pnpm --filter @lumio/worker watch`) against a small photos dir and confirm log lines like:
`processed 2024/IMG_0001.NEF.jxl (.jxl) 430ms` (scan) and `+ new/IMG.jxl (.jxl) 412ms` (watch on a new drop-in).

---

## Self-Review Notes

- **Spec coverage:** A1 PAM pipe → Tasks 1–3; A2 decode-once → Task 4; correctness (orientation/alpha/grayscale/dims) → Tasks 2 & 5; Part B per-photo timing → Tasks 6–8; bench re-measure → Task 9. HEIC stays on the temp-file path (Task 3). Phase 2 (native libvips) and richer logs are explicitly out of scope.
- **Type consistency:** `DecodedInput { input, raw?, rotate, cleanup }`, `RawImage { buffer, width, height, channels }`, and `PamHeader { width, height, channels, offset }` are used identically across `decode.ts`, `process.ts`, and the tests. `decodeJxlToRaw` returns `RawImage`; the dispatcher maps `RawImage.buffer → DecodedInput.input` and `{width,height,channels} → raw`.
- **Skips logged, not silent:** JXL tests `describe.skipIf(!JXL_TOOLS)` so machines without `cjxl`/`djxl` skip rather than fail; the runtime path already errors clearly (`no external decoder available`) when `djxl` is missing.
