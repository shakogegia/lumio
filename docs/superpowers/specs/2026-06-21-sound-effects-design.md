# Sound effects system — design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Branch:** `gego/wire-up-trash-sounds`

## Goal

Wire up two provided macOS-style sound effects to trash actions, and lay down a
reusable structure so future sound effects can be added with minimal effort.

Source assets (gitignored attachments):

- `.context/attachments/8DbLac/move_to_trash.aif`
- `.context/attachments/o9iGf0/empty_trash.aif`

## Decisions (from brainstorming)

1. **Scope (option B):** `move_to_trash` plays on **Move to Trash**;
   `empty_trash` plays on **both** "Empty trash" **and** "Delete permanently"
   (purge selected) — both are irreversible deletions.
2. **User control (option B):** a persisted **"Sound effects" on/off toggle**
   in Settings, stored in the DB like the other app settings; the player
   respects it.
3. **Timing (option A):** every sound plays **on success** — the sound confirms
   the action actually completed (consistent rule across all three call sites).
4. **Reusable structure:** the system is built as a small registry + player so
   adding a future sound is "add an enum member + a map entry + drop a file".

## Approaches considered

- **Playback engine:** `HTMLAudioElement` vs. Web Audio API. → **HTMLAudioElement.**
  These are short, non-overlapping UI cues; Web Audio's buffer decoding and
  user-gesture unlock are unnecessary complexity.
- **Toggle persistence:** DB singleton vs. localStorage (like the existing
  grid-columns store). → **DB**, because the toggle lives in Settings alongside
  the other persisted settings; localStorage would be device-only and sit apart
  from the rest.

## Architecture

### 1. Assets

Convert AIFF → MP3 with ffmpeg (Chrome and Firefox do not reliably decode AIFF;
only Safari does). Create the web app's first `public/` directory.

- `apps/web/public/sounds/move-to-trash.mp3`
- `apps/web/public/sounds/empty-trash.mp3`

Conversion command (per file):

```
ffmpeg -i <input>.aif -codec:a libmp3lame -qscale:a 4 <output>.mp3
```

The original `.aif` attachments are not committed (they live under gitignored
`.context/`).

### 2. Reusable sound module — `apps/web/src/lib/sound/`

**`registry.ts`**

- `enum SoundEffect { MoveToTrash, EmptyTrash }` (TS enum per project
  convention).
- A `Record<SoundEffect, string>` mapping each effect to its public URL
  (`/sounds/move-to-trash.mp3`, `/sounds/empty-trash.mp3`).
- Optional per-effect volume can be added later; default volume is a single
  module constant for now.
- **Adding a future sound = one enum member + one map entry + one file in
  `public/sounds/`.**

**`player.ts`** (client-only)

- Module-level `enabled` flag (default `true`) and `setSoundEnabled(b: boolean)`.
- `playSound(effect: SoundEffect): void`:
  - Returns immediately if `!enabled`.
  - SSR guard: no-op if `typeof Audio === "undefined"`.
  - Lazily constructs and caches one `HTMLAudioElement` per effect (URL from the
    registry); sets a default volume.
  - On each call resets `currentTime = 0` before `play()` so rapid re-triggers
    restart cleanly.
  - **Swallows all errors** from `.play()` (autoplay-policy rejections, decode
    failures). A sound effect must never throw into or block the action flow.
- These are plain functions, so they are callable from anywhere (hooks,
  callbacks, async job handlers) — not just React components.

### 3. Persisted toggle

**Prisma** (`packages/db/prisma/schema.prisma`): add to `AppSettings`

```prisma
soundEffectsEnabled Boolean @default(true)
```

Migration via the repo's shared-DB recipe: the Postgres on `localhost:5433` is
shared across all worktrees, so `prisma migrate dev` sees sibling branches'
migrations as drift and offers a destructive reset. **Never** run `migrate dev`,
`migrate reset`, or `--force`. Instead: edit the schema, **hand-write** the
migration SQL in a new timestamped folder, apply with `prisma migrate deploy`,
then regenerate the client (`pnpm db:generate`). This migration is
non-destructive — the column has a default, so the existing singleton row
migrates cleanly with no `DELETE`/backfill:

```sql
ALTER TABLE "AppSettings" ADD COLUMN "soundEffectsEnabled" BOOLEAN NOT NULL DEFAULT true;
```

**Shared** (`packages/shared/src/uploads.ts`):

- Make `updateSettingsSchema` fields **individually optional** and add
  `soundEffectsEnabled: z.boolean().optional()`. This lets the sound toggle and
  the upload-template form each send only their own field.

**DB** (`packages/db/src/settings.ts`):

- `AppSettingsDTO` gains `soundEffectsEnabled: boolean`.
- `getSettings` returns it.
- `updateSettings` becomes a **partial** update: it builds the Prisma
  `update`/`create` payload only from fields present in the input, so neither
  form clobbers the other's value. Returns the full DTO (both fields).

**API** (`apps/web/src/app/api/settings/route.ts`): unchanged — it already
validates the body through `updateSettingsSchema`.

### 4. Hydration (DB value → client player)

A tiny client component `SoundSettingsProvider` (`apps/web/src/components/`)
that takes an `enabled: boolean` prop and calls `setSoundEnabled(enabled)` from
an effect (keeping render pure — the module flag defaults to `true`, and the
gap between hydration and the effect is shorter than any click-plus-network
action, so no sound can fire in it). Mounted in
`apps/web/src/app/(app)/layout.tsx`, seeded from
`getSettings().soundEffectsEnabled` (the layout is an async server component, so
it can read settings directly). Renders no DOM.

### 5. Settings UI

New client component `apps/web/src/app/(app)/settings/sound-effects-form.tsx`:

- Uses the existing `Switch` (`@/components/ui/switch`).
- Optimistic toggle; calls `setSoundEnabled(next)` immediately for instant
  effect, then `PUT /api/settings` with `{ soundEffectsEnabled: next }`, then
  `router.refresh()`. Mirrors the `UploadTemplateForm` save pattern (idle /
  saving / saved / error). On error, reverts the optimistic state.

Placement: a new **"Preferences"** tab in the settings `Tabs`
(Catalog / Uploads / **Preferences** / Danger zone). The settings page passes
`initial={settings.soundEffectsEnabled}`.

### 6. Wiring (all on success)

- **`apps/web/src/components/photo-actions/use-photo-actions.tsx`** — in
  `trash()`, after the successful response and grid removal, call
  `playSound(SoundEffect.MoveToTrash)`. This single site covers library,
  favorites, search, albums, and the grid context menu.
- **`apps/web/src/app/(app)/trash/trash-view.tsx`:**
  - Empty trash: in `emptyTrash`'s `onComplete`, call
    `playSound(SoundEffect.EmptyTrash)`.
  - Delete permanently (purge): play `playSound(SoundEffect.EmptyTrash)` on
    success of the purge path **only** (not restore, which shares `act()`).
    Give `act()` an optional `onSuccess?: () => void` param fired after a
    successful request, and pass `() => playSound(SoundEffect.EmptyTrash)` from
    the purge button only — so the generic helper stays reusable and restore
    makes no sound.

### 7. Testing

- **`player.ts`** (vitest, mocked `Audio`): `playSound` is a no-op when
  `enabled` is false; plays when enabled; swallows a throwing `play()` without
  propagating.
- **`settings.ts`** (extend `settings.test.ts`): partial `updateSettings`
  preserves `uploadTemplate` when only `soundEffectsEnabled` is sent, and vice
  versa; defaults are returned by `getSettings`.

## Out of scope (YAGNI)

- Per-sound volume UI, additional sounds beyond the two provided, OS
  reduced-motion / mute detection, and any non-trash action sounds. The registry
  structure leaves room for these without rework.

## Files touched

- `packages/db/prisma/schema.prisma` (+ generated migration)
- `packages/db/src/settings.ts`, `packages/db/src/settings.test.ts`
- `packages/shared/src/uploads.ts`
- `apps/web/public/sounds/{move-to-trash,empty-trash}.mp3` (new)
- `apps/web/src/lib/sound/{registry,player}.ts` (+ `player.test.ts`)
- `apps/web/src/components/sound-settings-provider.tsx` (new)
- `apps/web/src/app/(app)/layout.tsx`
- `apps/web/src/app/(app)/settings/page.tsx`,
  `apps/web/src/app/(app)/settings/sound-effects-form.tsx` (new)
- `apps/web/src/components/photo-actions/use-photo-actions.tsx`
- `apps/web/src/app/(app)/trash/trash-view.tsx`
