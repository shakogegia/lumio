# Conductor Shared Photos/Cache + Seed Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Conductor workspace share one photo library + cache (like the shared Postgres), and remove the synthetic photo seeder entirely.

**Architecture:** No application code changes. Both apps resolve dirs via `path.resolve(ROOT, $PHOTOS_DIR)`, where an absolute value overrides the base — so `scripts/conductor/setup.sh` writes absolute `PHOTOS_DIR`/`CACHE_DIR` (anchored at `$CONDUCTOR_ROOT_PATH/data`) into the workspace `.env`, the single source of truth read by both the web dev server and the manual worker CLIs. Separately, the `seed:photos` tooling — the only destructive operation against `PHOTOS_DIR` and the worker's only `sharp`/`exifr` consumer — is deleted across code, build files, and living docs.

**Tech Stack:** Bash (Conductor lifecycle scripts), pnpm workspace, Node `path`, Docker, Make.

**Note on testing:** This change is shell + config + docs; the repo has no shell test harness. "Tests" here are concrete verification commands (grep sweeps, the existing `pnpm -r` suites, and a sandboxed run of the setup logic), not new unit tests. That is the honest verification path for this work.

**Spec:** `docs/superpowers/specs/2026-06-19-conductor-shared-media-design.md`

---

### Task 1: Remove the seed plumbing

Delete the seeder and every reference to it across code, build files, and living docs. After this task `grep -rn "seed"` returns only historical `docs/superpowers/**` records.

**Files:**
- Delete: `apps/worker/scripts/seed-photos.ts` (then the now-empty `apps/worker/scripts/` dir)
- Modify: `apps/worker/package.json` (remove `seed` script + `sharp`/`exifr` deps)
- Modify: `package.json` (remove root `seed:photos` script)
- Modify: `Makefile` (remove `seed` target + `.PHONY` entry)
- Modify: `Dockerfile` (remove `seed)` case + update header comment)
- Modify: `README.md:14` (replace seed quickstart line)
- Modify: `docs/STATUS.md` (lines 23, 32, 38)

- [ ] **Step 1: Delete the seeder file and its (now-empty) dir**

```bash
git rm apps/worker/scripts/seed-photos.ts
rmdir apps/worker/scripts 2>/dev/null || true
```

- [ ] **Step 2: Remove the `seed` script from the worker package**

In `apps/worker/package.json`, delete this line from `"scripts"`:

```json
    "seed": "tsx scripts/seed-photos.ts",
```

So the scripts block becomes exactly:

```json
  "scripts": {
    "ingest": "dotenv -e ../../.env -- tsx src/main.ts",
    "watch": "dotenv -e ../../.env -- tsx src/watch-main.ts",
    "test": "TZ=UTC vitest run",
    "typecheck": "tsc --noEmit"
  },
```

- [ ] **Step 3: Drop the now-unused `sharp` and `exifr` deps from the worker package**

`seed-photos.ts` was the only direct user of `sharp` in the worker, and `exifr` was never imported there (both are carried transitively by `@lumio/ingest`). In `apps/worker/package.json`, change the `dependencies` block from:

```json
  "dependencies": {
    "@lumio/db": "workspace:*",
    "@lumio/ingest": "workspace:*",
    "@lumio/shared": "workspace:*",
    "chokidar": "^5.0.0",
    "exifr": "^7",
    "sharp": "^0.33"
  },
```

to (note: remove the trailing comma after `"^5.0.0"`):

```json
  "dependencies": {
    "@lumio/db": "workspace:*",
    "@lumio/ingest": "workspace:*",
    "@lumio/shared": "workspace:*",
    "chokidar": "^5.0.0"
  },
```

- [ ] **Step 4: Remove the root `seed:photos` script**

In `package.json` (repo root), delete this line from `"scripts"`:

```json
    "seed:photos": "pnpm --filter @lumio/worker seed",
```

- [ ] **Step 5: Remove the `seed` target from the Makefile**

In `Makefile`, delete these three lines (currently 57–59) plus the trailing blank line that separated it from the `clean` comment:

```makefile
# Re-seed photos from PHOTOS_DIR (DESTRUCTIVE: wipes existing rows).
seed:
	$(COMPOSE) run --rm worker seed
```

Then edit the `.PHONY` line to drop `seed`. Change:

```makefile
.PHONY: dev build push up down logs shell migrate seed clean
```

to:

```makefile
.PHONY: dev build push up down logs shell migrate clean
```

- [ ] **Step 6: Remove the `seed` branch and comment from the Dockerfile**

In `Dockerfile`, delete this case branch:

```dockerfile
  seed)
    exec pnpm --filter @lumio/worker exec tsx scripts/seed-photos.ts
    ;;
```

Then update the header comment. Change:

```dockerfile
# supports `ingest`, `seed`, and `migrate` one-off commands.
```

to:

```dockerfile
# supports `ingest` and `migrate` one-off commands.
```

- [ ] **Step 7: Update the README quickstart**

In `README.md`, replace line 14:

```
pnpm seed:photos           # generate sample images into ./photos
```

with:

```
# add photos: upload via the web UI, or drop image files into ./photos (PHOTOS_DIR)
```

- [ ] **Step 8: Update docs/STATUS.md (3 edits)**

Edit 8a — replace the quickstart seed line (line 23):

```
pnpm seed:photos            # ⚠️ rm -rf's /photos first — DON'T run if you have real photos there
```

with:

```
# add photos: upload via the web UI, or drop image files into /photos (PHOTOS_DIR)
```

Edit 8b — the gotcha line (line 32). Change:

```
- **`/photos/` is gitignored** (user data). `pnpm seed:photos` is destructive.
```

to:

```
- **`/photos/` is gitignored** (user data). Add photos by uploading or dropping files into `PHOTOS_DIR`.
```

Edit 8c — the follow-ups line (line 38). Change:

```
- Follow-ups: derive `SmartAlbumRules` from the Zod schema; non-destructive `seed:photos`; optional per-workspace DBs; justified grid; smart-album rule editing.
```

to:

```
- Follow-ups: derive `SmartAlbumRules` from the Zod schema; optional per-workspace DBs; justified grid; smart-album rule editing.
```

- [ ] **Step 9: Refresh the lockfile after dropping deps**

Run: `pnpm install`
Expected: completes; `pnpm-lock.yaml` updates to drop the worker's direct `sharp`/`exifr` entries (they remain under `@lumio/ingest`). No error.

- [ ] **Step 10: Verify nothing references the seeder anymore**

Run: `grep -rnI "seed" . --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" --include="*.sh" --include="Makefile" --include="Dockerfile" --include="*.yml" | grep -v node_modules | grep -v pnpm-lock | grep -v "docs/superpowers/plans/2026-06-1" | grep -v "docs/superpowers/specs/2026-06-1"`
Expected: no output (only the historical plan/spec files under `docs/superpowers/**` may mention seed, and those are excluded/allowed). In particular, no hit in `apps/`, `package.json`, `Makefile`, `Dockerfile`, `README.md`, or the non-historical part of `docs/STATUS.md`.

- [ ] **Step 11: Verify typecheck and tests stay green**

Run: `pnpm -r typecheck`
Expected: PASS for every package (nothing imported the seeder).

Run: `pnpm -r test`
Expected: PASS (the worker/ingest suites still resolve `sharp`/`exifr` via `@lumio/ingest`).

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: remove synthetic photo seeder (upload-only workflow)"
```

---

### Task 2: Share photos & cache across workspaces via setup.sh

Point `PHOTOS_DIR`/`CACHE_DIR` at `$CONDUCTOR_ROOT_PATH/data/{photos,cache}` by rewriting the workspace `.env` during Conductor setup, and document the behavior in `.env.example`.

**Files:**
- Modify: `scripts/conductor/setup.sh` (insert block after the `BETTER_AUTH_SECRET` block, before the `pnpm install` step)
- Modify: `.env.example` (comment above `PHOTOS_DIR`/`CACHE_DIR`)

- [ ] **Step 1: Add the shared-media block to setup.sh**

In `scripts/conductor/setup.sh`, insert the following block immediately after the `BETTER_AUTH_SECRET` block's closing `fi` (currently line 34) and before the `# Install dependencies...` comment (currently line 36). Add one blank line before and after it:

```bash
# Shared media: point PHOTOS_DIR/CACHE_DIR at the root checkout's data/ dir so
# every workspace reads/writes one library + cache (mirrors the shared Postgres).
# Only under Conductor; manual/CI runs keep the workspace-local ./photos|./cache.
# These two lines are derived, not user-authored, so we always overwrite them
# (idempotent on re-run). Same grep -v / .env.tmp / mv pattern as the secret block.
if [ -n "${CONDUCTOR_ROOT_PATH:-}" ]; then
  data_root="$CONDUCTOR_ROOT_PATH/data"
  mkdir -p "$data_root/photos" "$data_root/cache"
  grep -vE '^(PHOTOS_DIR|CACHE_DIR)=' .env > .env.tmp || true
  { printf 'PHOTOS_DIR="%s"\n' "$data_root/photos"
    printf 'CACHE_DIR="%s"\n'  "$data_root/cache"; } >> .env.tmp
  mv .env.tmp .env
  echo "setup: pointed PHOTOS_DIR/CACHE_DIR at shared $data_root"
fi
```

- [ ] **Step 2: Document the rewrite in .env.example**

In `.env.example`, insert this comment immediately above the `PHOTOS_DIR="./photos"` line (currently line 3):

```
# Source-of-truth originals + regenerable cache. Relative paths resolve from the
# repo root. Under Conductor, scripts/conductor/setup.sh rewrites these to an
# absolute shared path ($CONDUCTOR_ROOT_PATH/data/{photos,cache}) so every
# workspace shares one library + cache (like the shared Postgres).
```

- [ ] **Step 3: Verify the setup.sh syntax is valid**

Run: `bash -n scripts/conductor/setup.sh`
Expected: no output, exit 0 (script parses).

- [ ] **Step 4: Verify the rewrite logic in a sandbox (and that it's idempotent)**

This exercises the exact commands from the new block against a throwaway `.env`, with no `pnpm install`. Run:

```bash
sandbox="$(mktemp -d)"; root="$(mktemp -d)"
cp .env.example "$sandbox/.env"
(
  cd "$sandbox"
  data_root="$root/data"
  for run in 1 2; do
    mkdir -p "$data_root/photos" "$data_root/cache"
    grep -vE '^(PHOTOS_DIR|CACHE_DIR)=' .env > .env.tmp || true
    { printf 'PHOTOS_DIR="%s"\n' "$data_root/photos"
      printf 'CACHE_DIR="%s"\n'  "$data_root/cache"; } >> .env.tmp
    mv .env.tmp .env
  done
  echo "--- PHOTOS_DIR/CACHE_DIR lines after two runs ---"
  grep -E '^(PHOTOS_DIR|CACHE_DIR)=' .env
  echo "--- counts (must each be 1) ---"
  printf 'PHOTOS_DIR=%s CACHE_DIR=%s\n' \
    "$(grep -cE '^PHOTOS_DIR=' .env)" "$(grep -cE '^CACHE_DIR=' .env)"
  echo "--- dirs created ---"
  ls -d "$data_root/photos" "$data_root/cache"
)
rm -rf "$sandbox" "$root"
```

Expected:
- `PHOTOS_DIR="<root>/data/photos"` and `CACHE_DIR="<root>/data/cache"` (absolute).
- `PHOTOS_DIR=1 CACHE_DIR=1` — exactly one of each line after running the logic twice (idempotent, no duplicates).
- Both `data/photos` and `data/cache` dirs listed (created).

- [ ] **Step 5: Confirm an absolute PHOTOS_DIR resolves correctly (no app code change needed)**

Run: `node -e "const p=require('path'); console.log(p.resolve('/repo/root','/abs/data/photos'))"`
Expected: `/abs/data/photos` (an absolute value overrides the base — confirms `apps/web/src/lib/paths.ts` and `apps/worker/src/config.ts` will use the shared dir verbatim).

- [ ] **Step 6: Commit**

```bash
git add scripts/conductor/setup.sh .env.example
git commit -m "feat(conductor): share photos/cache across workspaces via root data/ dir"
```

---

## Self-Review

**Spec coverage:**
- Part 1 (shared dirs via absolute paths in `.env`, anchored at `CONDUCTOR_ROOT_PATH/data`, idempotent, mkdir, fallback when unset) → Task 2, Steps 1, 3–6.
- Part 1 `.env.example` comment → Task 2, Step 2.
- Part 2 seed removal (seeder file, worker pkg script + `sharp`/`exifr`, root script, Makefile, Dockerfile, README, STATUS.md) → Task 1, Steps 1–8.
- Verification (`pnpm install`, typecheck/test green, grep sweep, sandboxed setup run, end-to-end) → Task 1 Steps 9–11 + Task 2 Steps 3–5. (End-to-end cross-workspace upload check is manual post-merge, noted in the spec.)
- Out-of-scope items (data migration, per-workspace DBs, prod bind mounts) → correctly absent from the plan.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" placeholders. Every code/config step shows the exact before/after content and every verify step shows the command + expected output.

**Type/name consistency:** Env var names `PHOTOS_DIR`/`CACHE_DIR`, the `$CONDUCTOR_ROOT_PATH/data/{photos,cache}` layout, and the `data_root` shell var are used identically in the spec, the setup.sh block (Task 2 Step 1), and the sandbox verification (Task 2 Step 4). The worker `dependencies` block in Task 1 Step 3 matches the file's current content captured from the repo.
