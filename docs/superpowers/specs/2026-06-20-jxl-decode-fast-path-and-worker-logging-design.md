# JXL Decode Fast-Path + Per-Photo Timing Logs

**Date:** 2026-06-20
**Status:** Proposed — awaiting review
**Target deploy:** Intel N100 mini-PC worker container (4 cores). Library is **Nikon RAW (.NEF) transcoded to JPEG XL (.jxl), ~45 MP, tens of thousands of files** — JPEG-reconstruction–mode JXL (confirmed via `jxlinfo`: "JPEG bitstream reconstruction data available").
**Relationship to prior work:** Complementary to the merged `2026-06-20-ingest-performance-design.md` (#35: incremental scan + bounded concurrency + threadpool sizing) and the bench changes in #37 (`feat(bench): live progress heartbeat + per-format serial breakdown`). #35 optimized **orchestration** and measured its baseline on a **JPG** library, treating `processImage`'s decode internals as a non-goal. This spec optimizes the **per-image `processImage` cost for JXL**, which #35 never measured. The two stack: #35's pool multiplies the smaller per-image constant this spec produces.

---

## Revision (2026-06-20): PAM → JPEG intermediate

The PAM raw-pipe described below shipped, then broke on the real library. Nikon
**NEF→JXL exports are 16-bit *float* (HDR), P3, RGB+Alpha**, and djxl **cannot
encode float pixels into PAM/PPM** (integer-only): `"Decoded to pixels. Encode
failed"` → exit 1 → upload `500`. The decode now pipes **`djxl --output_format
jpeg`** instead, which tonemaps float/high-bit-depth down to 8-bit (and
losslessly reconstructs JPEG-sourced JXLs). Sharp reads the JPEG like a native
input, auto-orienting via EXIF. Consequences vs. the PAM design below:

- **Measured win is ~6×** on real 4499×6002 float files (≈1.0 s vs ≈6.1 s), not
  8×. Output is visually identical to the old temp-PNG path (mean color diff
  1.94/255); the files' alpha is fully opaque so the JPEG dropping it loses
  nothing.
- The PAM parser, `RawImage`, and the raw-buffer branch are **deleted** —
  `processImage` is now a single path. This also removes a latent bug where
  16-bit *integer* JXLs were silently corrupted (PAM `MAXVAL` was ignored).
- Sections A1/A2 below are superseded by `decodeToSharpInput` returning a JPEG
  buffer for `.jxl`; the **decode-once** idea and **Part B** (per-photo timing)
  are unchanged.
- Stored `width`/`height` are now **orientation-aware for every format** (EXIF 5-8
  swap W/H). This also fixes native (non-JXL) oriented photos, which previously
  stored pre-rotation dims — so a re-ingest of an oriented JPEG/HEIC may change
  its recorded dimensions to match the displayed orientation.

Everything below is the original design, kept for context.

---

## Problem

### Part A — JXL is the worst case for the current decode path

`packages/ingest/src/decode.ts` cannot hand `.jxl` to Sharp (prebuilt libvips has **zero JXL support** — verified `sharp.format.jxl.input` is `file/buffer/stream: false`). So every JXL goes through `decodeToReadable`, which:

1. shells out to `djxl input.jxl /tmp/decoded.png`,
2. has `djxl` **zlib-compress a full-resolution PNG** to a temp file (a 45 MP image → ~130 MB PNG), then
3. lets Sharp **re-read and re-decode that PNG 2–3 times** in `process.ts` (`metadata()`, thumbnail, display).

**Severity on the actual hardware:** `pnpm bench` on the N100 reported a **114 s warmup** — that is a *single* `processImage` of one ~45 MP NEF→JXL. At ~100 s/image, the library is effectively un-ingestable. Profiling shows the JXL→pixels work is *not* the cost; the PNG encode + triple re-decode is (see Baseline). The bottleneck is algorithmic, not the language — which is why a Go rewrite was rejected during brainstorming (the hot path is already native C/libvips).

### Part B — no per-photo timing in the worker logs

The deployed worker logs a bootstrap banner and `+ rel` / `- rel` per watch event, but **nothing about how long each photo takes**. On a slow box that is the one number the operator wants while watching `docker logs`.

---

## Measured Baseline (reproducible; dev box, `sharp.concurrency(1)`, avg of 4–6)

**45 MP JPEG-transcoded JXL (matches the real library):**

| Path | djxl/decode | Sharp | **Total / photo** |
|---|---|---|---|
| **Current** (djxl → temp PNG → Sharp ×3) | 2629 ms | 759 ms | **~3388 ms** |
| **PAM raw pipe** (this design) | 155 ms | 267 ms | **~423 ms** |
| JPEG reconstruct → Sharp (rejected) | 338 ms | 404 ms | 742 ms |

**≈ 8× per JXL photo**, no rewrite, no custom libvips, no new dependency. Display output is byte-identical in size to today (249 KB). The win grows with megapixels (the PNG intermediate scales worse than the decode), so it is *larger* on these 45 MP files than on 24 MP (~6.4×).

**Alternatives evaluated and rejected** (recorded so they aren't re-investigated):
- **`djxl --downsampling=1|2|4|8`** — only acts on JXLs encoded with progressive/responsive hints. These are JPEG-reconstruction JXLs with no such hints: `-s 4` returns byte-identical full-res output. No benefit. Not usable.
- **JPEG reconstruct** (`djxl --output_format jpeg`, then Sharp shrink-on-load) — correct and lossless, but slower (742 ms) because Sharp must then fully decode the reconstructed 45 MP JPEG, whereas PAM hands Sharp already-decoded pixels. PAM wins.

---

## Goals

- Cut per-JXL `processImage` cost ~8× by eliminating the PNG intermediate and the redundant re-decodes.
- Stay inside the existing Node/Sharp stack — no Go, no custom libvips, no new npm/runtime deps.
- No correctness regression: identical output dimensions, orientation, alpha, and thumbhash semantics as today.
- Log **how long each photo took** (per-photo timing), readable via `docker logs`.

## Non-Goals

- Re-litigating #35 (incremental scan, pool, threadpool, `INGEST_CONCURRENCY`) — assumed merged, unchanged.
- Changing thumbnail/display **dimensions or format** (still 400 / 2048 px, WebP q80).
- A full logging framework (levels, JSON, ETA, heartbeat, startup decoder check) — explicitly descoped per operator preference to **per-photo timing only**. Recorded as easy future adds.
- Native in-process JXL via custom libvips — documented as **Phase 2 (optional)**, not built.
- Rebuilding the Docker image (already installs `djxl` via `libjxl-tools`).

---

## Part A — JXL Decode Fast-Path

### A1. `decode.ts`: raw PAM pipe for JXL, keep temp-file for HEIC

Replace `decodeToReadable` (always returns a *path*) with `decodeToSharpInput`, returning a descriptor so `process.ts` builds the right Sharp input:

```ts
export interface DecodedInput {
  /** Sharp input: original path (native), raw pixel buffer (JXL), or temp PNG path (HEIC). */
  input: string | Buffer;
  /** Present iff `input` is raw pixels → caller uses sharp(input, { raw }). */
  raw?: { width: number; height: number; channels: number };
  /** Whether Sharp must apply EXIF orientation. False for already-upright pixels (JXL/HEIC). */
  rotate: boolean;
  /** Remove temp artifacts (HEIC temp PNG); no-op for native/JXL. */
  cleanup: () => Promise<void>;
}
```

Dispatch by extension:
- **Native** (`.jpg/.jpeg/.png/.webp/.avif/.tiff/.tif/.gif`): `{ input: absPath, rotate: true, cleanup: noop }` — unchanged.
- **JXL** (`.jxl`): `spawn('djxl', [path, '-', '--output_format', 'pam'])`, collect stdout, parse the PAM header, return `{ input: rawBody, raw: {width,height,channels}, rotate: false, cleanup: noop }`. **No temp file, no disk.**
- **HEIC/HEIF**: keep the existing `sips`/`heif-convert` → temp-PNG path with `cleanup` (sips can't stream; library is JXL, so untouched). `rotate: true`.

**PAM, not PPM** (verified): PAM (`P7`) carries `DEPTH`/`TUPLTYPE`, so the pipe handles **RGBA** (`DEPTH 4`, alpha preserved) and **grayscale** (`djxl` may emit `DEPTH 1`). The code reads `DEPTH` dynamically and passes it straight to `sharp(raw, { channels })`, so 1/3/4 all work — do NOT hard-code 3 channels. PPM (`P6`) is RGB-only and would silently drop alpha. Header is ASCII lines terminated by `ENDHDR\n`; the raw body follows immediately.

**Use `spawn`, not `execFile`** — a 45 MP RGB image is ~136 MB of raw stdout, far over `execFile`'s 1 MB `maxBuffer`. Collect chunks, `Buffer.concat` on `close`.

Header parser:
```ts
function parsePAM(buf: Buffer): { width: number; height: number; channels: number; offset: number } {
  const end = buf.indexOf("ENDHDR\n");
  const hdr = buf.toString("ascii", 0, end).split("\n");
  const get = (k: string) => { const l = hdr.find(x => x.startsWith(k)); return l ? +l.split(/\s+/)[1] : 0; };
  return { width: get("WIDTH"), height: get("HEIGHT"), channels: get("DEPTH"), offset: end + 7 };
}
```

`CONVERTERS`/`onPath`/`resolveConverter` stay (HEIC still uses them); JXL gets its own pipe branch.

### A2. `process.ts`: decode once, derive both renditions

```ts
const original = await readFile(absPath);          // for SHA-256 + EXIF (unchanged)
const decoded  = await decodeToSharpInput(absPath);
try {
  const { exif, takenAt } = await extractMetadata(original);
  const fit = { fit: "inside", withoutEnlargement: true } as const;
  let width: number, height: number, display: Buffer, thumbnail: Buffer;

  if (decoded.raw) {
    // JXL: pixels already in memory — re-wrapping the buffer costs no decode,
    // so derive BOTH renditions from full-quality raw.
    ({ width, height } = decoded.raw);
    const src = () => sharp(decoded.input as Buffer, { raw: decoded.raw });
    display   = await src().resize(DISPLAY_MAX, DISPLAY_MAX, fit).webp({ quality: 80 }).toBuffer();
    thumbnail = await src().resize(THUMBNAIL_MAX, THUMBNAIL_MAX, fit).webp({ quality: 80 }).toBuffer();
  } else {
    // native / HEIC temp PNG: decode once for the display, derive the thumbnail from it.
    const meta = await sharp(decoded.input).metadata();
    width = meta.width ?? 0; height = meta.height ?? 0;
    const pipe = sharp(decoded.input);
    if (decoded.rotate) pipe.rotate();
    display   = await pipe.resize(DISPLAY_MAX, DISPLAY_MAX, fit).webp({ quality: 80 }).toBuffer();
    thumbnail = await sharp(display).resize(THUMBNAIL_MAX, THUMBNAIL_MAX, fit).webp({ quality: 80 }).toBuffer();
  }

  const thumbhash = await computeThumbhash(thumbnail);
  const hash = createHash("sha256").update(original).digest("hex");
  return { width, height, takenAt, hash, thumbhash, exif, thumbnail, display };
} finally {
  await decoded.cleanup();
}
```

### Correctness (all verified by measurement, not assumed)

- **Orientation:** a 400×200 image tagged EXIF `orientation=6`, transcoded to JXL, decodes via **both** the old PNG path and the new PAM pipe to **200×400 with no residual EXIF orientation** — `djxl` bakes orientation into pixels. `rotate: false` on the JXL path is equivalent to today (where `.rotate()` was already a no-op on the EXIF-less temp PNG). **No regression.**
- **Alpha / grayscale:** RGBA round-trips (`DEPTH 4` → `sharp(raw,{channels:4})`); grayscale comes through as `djxl`'s emitted `DEPTH` (often `1`), read dynamically and passed to Sharp's `channels`. Both encode correctly.
- **Stored dimensions:** JXL uses PAM header dims (orientation already applied — same values the old PNG path produced); native keeps `metadata()`. Equivalent.
- **`hash` + EXIF + `thumbhash`:** unchanged (hash/EXIF from original bytes; thumbhash from the final thumbnail buffer, so ingest and the existing backfill stay identical).

---

## Part B — Per-Photo Timing Logs (minimal)

The only logging change: **emit how long each photo took.** No new logger module, no levels — match the existing `console.*` style.

- **`scan.ts`** — time each successful `ingestPath` with `performance.now()` and log one line:
  `processed <relPath> (.jxl) 418ms`. Failures keep today's `skip <rel>: <reason>` warning; the end-of-scan `ScanSummary` log (processed / skippedUnchanged / removed, from #35) stays.
- **`watch.ts`** — append timing to the existing event line: `+ <relPath> (.jxl) 418ms`.

For a slow, large import this is one line per photo (not spammy at ~hundreds of ms–seconds each) and answers "how long per photo" directly. `relPath` already identifies the file; the extension flags the heavy `.jxl`/`.NEF.jxl` ones at a glance. No change to `ingestPath`'s signature is required for timing; if per-photo dimensions are wanted later, `ingestPath` can return `{ id, width, height }` — noted as a trivial follow-up, not built now.

---

## Phase 2 (optional, documented — NOT built now)

Native JXL in libvips: install/build libvips **with libjxl** and point Sharp at it via `SHARP_FORCE_GLOBAL_LIBVIPS=1`. Then `sharp("photo.jxl")` decodes in-process — no subprocess, no PAM pipe, native EXIF/orientation. Trade-off: gives up Sharp's self-contained prebuilt binary and takes on matching libvips across dev/CI/the worker image. Given Part A already turns ~3.4 s into ~0.42 s, pursue only if that headroom proves insufficient. Composes on top of A2's decode-once derivation.

## Out of Scope / Future

- **EXIF for JXL** — `exifr` likely can't read `.jxl`, so `takenAt` may already be null today. `djxl --output_format exif` (or reading the NEF) could backfill it. Separate correctness task.
- **HEIC raw-pipe** — `sips` can't stream; only relevant if a HEIC library appears.
- **Streaming djxl→Sharp** (read PAM header off the stream, pipe the body) to cut peak RAM — only if the N100 shows memory pressure.
- **Richer logs** (ETA, idle heartbeat, startup decoder-presence check, JSON) — descoped to per-photo timing; trivial to add later.

---

## Testing

- **`@lumio/ingest` unit:** `parsePAM` on RGB / RGBA / grayscale-normalized headers (dims, channels, body offset). `decodeToSharpInput` dispatch: native→path+`rotate:true`, JXL→raw buffer+`raw`+`rotate:false`, HEIC→temp path+cleanup. Commit a tiny `.jxl` fixture; **skip JXL tests when `djxl` is absent** (mirrors the runtime requirement; keeps CI green where it isn't installed).
- **`@lumio/ingest` integration:** a fixture JXL through `processImage` yields thumbnail + display + thumbhash with expected dims; an orientation-tagged fixture decodes upright (regression guard).
- **Bench:** no code change needed — `apps/worker/src/bench.ts` already times `processImage` and breaks down by format (#37). Re-run `pnpm bench` on the N100 before/after to confirm the `.jxl` row drops ~8×.
- Existing ingest/scan/store tests stay green.

## Risks & Mitigations

- **Peak RAM** — 45 MP RGB raw ≈ 136 MB; `spawn` buffering ≈ 2× per in-flight image. Bounded by `INGEST_CONCURRENCY` (N100 default 2 → ~0.5 GB transient + libvips working set). Fine on a typical N100 (8–16 GB); document the streaming option (Future) if it ever bites. The old path traded this for disk I/O; this trades disk for short-lived RAM.
- **`djxl` missing from an image** — every JXL fails. The Dockerfile already installs `libjxl-tools`; the failure path still logs `skip … no external decoder`.
- **`djxl` flag drift** (`--output_format pam`, stdout `-`) — pinned by the base image; integration test + bench catch a break.
- **Thumbnail quality (native path)** — derived from the q80 display rather than source; negligible at 400 px. The JXL path avoids it by deriving from raw.

## Files Touched

- `packages/ingest/src/decode.ts` — `decodeToSharpInput` + JXL PAM pipe + `parsePAM`; keep HEIC temp-file path.
- `packages/ingest/src/process.ts` — decode-once / derive-both; raw vs native branches.
- `apps/worker/src/scan.ts` — per-photo timing log on success.
- `apps/worker/src/watch.ts` — append timing to the event line.
- Tests under `packages/ingest` (+ a small `.jxl` fixture).

## Expected Outcome

| | Today | After Part A |
|---|---|---|
| Per **45 MP JXL** photo (`processImage`, conc=1) | ~3388 ms | **~423 ms** (≈8×) |
| N100 single-image (bench warmup) | ~114 s | proportionally far lower; re-measure with `pnpm bench` |
| Tens-of-thousands JXL import, N100 (with #35 pool) | effectively never | bounded by ~8× lower per-image cost |
| Operator sees per-photo time in `docker logs` | no | yes |
