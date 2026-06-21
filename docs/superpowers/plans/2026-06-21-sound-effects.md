# Sound effects system — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a `move-to-trash` sound when photos are moved to Trash and an `empty-trash` sound when Trash is emptied or photos are permanently deleted, gated by a DB-persisted "Sound effects" toggle in Settings — built on a small reusable sound registry/player so future sounds drop in trivially.

**Architecture:** A client-only sound module (`lib/sound/`) exposes `playSound(effect)` plus a module-level `enabled` flag set from the DB setting via a tiny client provider mounted in the app layout. The toggle persists through the existing `AppSettings` singleton (Prisma → shared zod schema → `PUT /api/settings`), whose update path becomes partial so the sound toggle and the upload-template form never clobber each other. Sounds fire on success at the three existing action sites.

**Tech Stack:** TypeScript, Next.js (App Router, RSC), Prisma 6 + Postgres, Zod, Vitest, pnpm workspaces, radix-ui Switch, ffmpeg (asset conversion).

**Spec:** `docs/superpowers/specs/2026-06-21-sound-effects-design.md`

---

## File Map

| File | Change |
| --- | --- |
| `apps/web/public/sounds/move-to-trash.mp3` | **new** — converted from AIFF |
| `apps/web/public/sounds/empty-trash.mp3` | **new** — converted from AIFF |
| `packages/db/prisma/schema.prisma:93-97` | `AppSettings`: add `soundEffectsEnabled Boolean @default(true)` |
| `packages/db/prisma/migrations/20260621150000_add_sound_effects_enabled/migration.sql` | **new** — additive `ALTER TABLE` |
| `packages/shared/src/uploads.ts:47-53` | `updateSettingsSchema`: make `uploadTemplate` optional + add `soundEffectsEnabled` optional |
| `packages/db/src/settings.ts` | DTO + `getSettings`/`updateSettings` carry `soundEffectsEnabled`; partial update |
| `packages/db/src/settings.test.ts` | tests for partial update + new field |
| `apps/web/src/lib/sound/registry.ts` | **new** — `SoundEffect` enum + URL map + volume |
| `apps/web/src/lib/sound/player.ts` | **new** — `playSound` / `setSoundEnabled` |
| `apps/web/src/lib/sound/player.test.ts` | **new** — player behavior |
| `apps/web/src/components/sound-settings-provider.tsx` | **new** — hydrates `enabled` from server |
| `apps/web/src/app/(app)/layout.tsx` | mount provider, seeded from `getSettings()` |
| `apps/web/src/app/(app)/settings/sound-effects-form.tsx` | **new** — Switch toggle |
| `apps/web/src/app/(app)/settings/page.tsx` | new "Preferences" tab |
| `apps/web/src/components/photo-actions/use-photo-actions.tsx:160-168` | play `MoveToTrash` on success |
| `apps/web/src/app/(app)/trash/trash-view.tsx` | play `EmptyTrash` on empty + purge success |

**Sequencing notes:**
- Task 2 (migration) is the only step that touches the shared database. A subagent MUST stage the files and let the **human** run the apply/generate steps (2.4–2.5). It is additive and non-destructive (defaulted column).
- After Task 2 regenerates the Prisma client, `settings.ts` (Task 4) and the layout (Task 6) reference `row.soundEffectsEnabled`; until those land there may be a transient TS error, but Vitest (esbuild) ignores type errors so per-task gates stay green. Run `next build` only in the final verification (Task 10).
- Tasks 5–9 (web) do not depend on the DB apply having run, except that the *runtime* toggle reads the DB value; unit tests for them don't need the DB.

---

## Task 1: Convert AIFF assets to MP3

**Files:**
- Create: `apps/web/public/sounds/move-to-trash.mp3`
- Create: `apps/web/public/sounds/empty-trash.mp3`

- [ ] **Step 1.1: Create the public sounds directory**

Run:
```bash
mkdir -p apps/web/public/sounds
```

- [ ] **Step 1.2: Convert both files with ffmpeg**

Run (from repo root):
```bash
ffmpeg -y -i .context/attachments/8DbLac/move_to_trash.aif -codec:a libmp3lame -qscale:a 4 apps/web/public/sounds/move-to-trash.mp3
ffmpeg -y -i .context/attachments/o9iGf0/empty_trash.aif   -codec:a libmp3lame -qscale:a 4 apps/web/public/sounds/empty-trash.mp3
```
Expected: each command ends with a `size=… time=…` summary line and exit code 0.

- [ ] **Step 1.3: Verify the outputs exist and are valid MP3**

Run:
```bash
file apps/web/public/sounds/move-to-trash.mp3 apps/web/public/sounds/empty-trash.mp3
```
Expected: both report `Audio file with ID3 ... layer III` (or `MPEG ADTS, layer III`).

- [ ] **Step 1.4: Commit**

```bash
git add apps/web/public/sounds/move-to-trash.mp3 apps/web/public/sounds/empty-trash.mp3
git commit -m "feat(web): add trash sound assets (mp3)"
```

---

## Task 2: AppSettings migration — `soundEffectsEnabled`

> ⚠️ **SHARED DATABASE.** Every Conductor worktree points at the same Postgres (`localhost:5433`, db `lumio`). Per project memory, `prisma migrate dev` sees sibling branches' migrations as drift and offers a destructive reset. **Never** run `migrate dev`, `migrate reset`, or `--force`. Hand-write the SQL and apply with `migrate deploy`. This migration is additive (defaulted column) and does **not** delete data. A subagent MUST stage Steps 2.1 and 2.3 and let the **human** run Steps 2.2, 2.4, 2.5.

**Files:**
- Modify: `packages/db/prisma/schema.prisma:93-97` (the `AppSettings` model)
- Create: `packages/db/prisma/migrations/20260621150000_add_sound_effects_enabled/migration.sql`

- [ ] **Step 2.1: Add the field to the `AppSettings` model**

In `packages/db/prisma/schema.prisma`, change:
```prisma
model AppSettings {
  id             Int      @id @default(1)
  uploadTemplate String   @default("{YYYY}/{YYYY}-{MM}-{DD}/{filename}")
  updatedAt      DateTime @updatedAt
}
```
to:
```prisma
model AppSettings {
  id                  Int      @id @default(1)
  uploadTemplate      String   @default("{YYYY}/{YYYY}-{MM}-{DD}/{filename}")
  soundEffectsEnabled Boolean  @default(true)
  updatedAt           DateTime @updatedAt
}
```

- [ ] **Step 2.2: Check migration status (read-only, HUMAN-RUN)**

Run: `pnpm --filter @lumio/db exec prisma migrate status`
Expected: lists applied migrations. It may also report drift from sibling branches — that is the shared-DB situation; do NOT act on it, do NOT reset.

- [ ] **Step 2.3: Hand-write the migration SQL**

Create `packages/db/prisma/migrations/20260621150000_add_sound_effects_enabled/migration.sql` with exactly:
```sql
-- Add a per-app "sound effects enabled" preference. Additive and non-destructive:
-- the DEFAULT lets the existing singleton AppSettings row migrate cleanly.
ALTER TABLE "AppSettings" ADD COLUMN "soundEffectsEnabled" BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 2.4: Apply the migration (HUMAN-RUN)**

Run: `pnpm --filter @lumio/db exec prisma migrate deploy`
Expected: `Applying migration 20260621150000_add_sound_effects_enabled` then `All migrations have been successfully applied.`

If `migrate deploy` reports the migration as already-failed or errors on drift, STOP and report — do not run `migrate dev` or `reset`.

- [ ] **Step 2.5: Regenerate the Prisma client (HUMAN-RUN)**

Run: `pnpm db:generate`
Expected: `Generated Prisma Client` success. The `AppSettings` type now has `soundEffectsEnabled: boolean`.

- [ ] **Step 2.6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260621150000_add_sound_effects_enabled/migration.sql
git commit -m "feat(db): add soundEffectsEnabled to AppSettings"
```

---

## Task 3: Shared schema — partial settings update

**Files:**
- Modify: `packages/shared/src/uploads.ts:47-53`

- [ ] **Step 3.1: Make the schema fields optional and add the new one**

In `packages/shared/src/uploads.ts`, replace:
```ts
export const updateSettingsSchema = z.object({
  uploadTemplate: z
    .string()
    .refine((t) => validateTemplate(t).ok, { message: "Invalid upload template" }),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
```
with:
```ts
export const updateSettingsSchema = z.object({
  uploadTemplate: z
    .string()
    .refine((t) => validateTemplate(t).ok, { message: "Invalid upload template" })
    .optional(),
  soundEffectsEnabled: z.boolean().optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
```

- [ ] **Step 3.2: Typecheck the shared package**

Run: `pnpm --filter @lumio/shared exec tsc --noEmit`
Expected: no errors. (`tsc` is not a CI gate here, but this catches a typo early.)

- [ ] **Step 3.3: Commit**

```bash
git add packages/shared/src/uploads.ts
git commit -m "feat(shared): allow partial settings update incl. soundEffectsEnabled"
```

---

## Task 4: DB settings service — carry & partial-update the field

**Files:**
- Modify: `packages/db/src/settings.ts`
- Test: `packages/db/src/settings.test.ts`

- [ ] **Step 4.1: Update the fake DB + write failing tests**

In `packages/db/src/settings.test.ts`, replace the `fakeDb` helper and add tests so the file reads:
```ts
import { describe, expect, it } from "vitest";
import { getSettings, updateSettings } from "./settings.js";

function fakeDb(row: { id: number; uploadTemplate: string; soundEffectsEnabled: boolean }) {
  const calls: unknown[] = [];
  return {
    calls,
    appSettings: {
      upsert: async (args: unknown) => {
        calls.push(args);
        return row;
      },
    },
  };
}

describe("getSettings", () => {
  it("upserts the singleton row (id=1) and returns both fields", async () => {
    const db = fakeDb({ id: 1, uploadTemplate: "{filename}", soundEffectsEnabled: true });
    const settings = await getSettings(db as never);
    expect(settings).toEqual({ uploadTemplate: "{filename}", soundEffectsEnabled: true });
    expect(db.calls[0]).toMatchObject({ where: { id: 1 }, create: { id: 1 }, update: {} });
  });
});

describe("updateSettings", () => {
  it("writes only uploadTemplate when only it is provided", async () => {
    const db = fakeDb({ id: 1, uploadTemplate: "{YYYY}/{filename}", soundEffectsEnabled: true });
    const settings = await updateSettings({ uploadTemplate: "{YYYY}/{filename}" }, db as never);
    expect(settings).toEqual({ uploadTemplate: "{YYYY}/{filename}", soundEffectsEnabled: true });
    expect(db.calls[0]).toMatchObject({
      where: { id: 1 },
      create: { id: 1, uploadTemplate: "{YYYY}/{filename}" },
      update: { uploadTemplate: "{YYYY}/{filename}" },
    });
  });

  it("writes only soundEffectsEnabled when only it is provided (no uploadTemplate key)", async () => {
    const db = fakeDb({ id: 1, uploadTemplate: "{filename}", soundEffectsEnabled: false });
    const settings = await updateSettings({ soundEffectsEnabled: false }, db as never);
    expect(settings.soundEffectsEnabled).toBe(false);
    const args = db.calls[0] as { create: object; update: object };
    expect(args).toMatchObject({
      where: { id: 1 },
      create: { id: 1, soundEffectsEnabled: false },
      update: { soundEffectsEnabled: false },
    });
    expect(args.update).not.toHaveProperty("uploadTemplate");
    expect(args.create).not.toHaveProperty("uploadTemplate");
  });
});
```

- [ ] **Step 4.2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/db exec vitest run src/settings.test.ts`
Expected: FAIL — `getSettings` returns no `soundEffectsEnabled`, and `updateSettings` includes an `uploadTemplate` key even when not provided.

- [ ] **Step 4.3: Implement the partial update**

Replace the body of `packages/db/src/settings.ts` with:
```ts
import type { PrismaClient } from "@prisma/client";
import type { UpdateSettingsInput } from "@lumio/shared";
import { prisma } from "./client.js";

const SINGLETON_ID = 1;

export interface AppSettingsDTO {
  uploadTemplate: string;
  soundEffectsEnabled: boolean;
}

/** Get the singleton settings row, creating it with defaults if absent. */
export async function getSettings(
  db: Pick<PrismaClient, "appSettings"> = prisma,
): Promise<AppSettingsDTO> {
  const row = await db.appSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID },
    update: {},
  });
  return { uploadTemplate: row.uploadTemplate, soundEffectsEnabled: row.soundEffectsEnabled };
}

/** Persist a partial settings change on the singleton row — only the fields
 *  present in `input` are written, so independent forms don't clobber each other. */
export async function updateSettings(
  input: UpdateSettingsInput,
  db: Pick<PrismaClient, "appSettings"> = prisma,
): Promise<AppSettingsDTO> {
  const data: { uploadTemplate?: string; soundEffectsEnabled?: boolean } = {};
  if (input.uploadTemplate !== undefined) data.uploadTemplate = input.uploadTemplate;
  if (input.soundEffectsEnabled !== undefined) data.soundEffectsEnabled = input.soundEffectsEnabled;
  const row = await db.appSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...data },
    update: data,
  });
  return { uploadTemplate: row.uploadTemplate, soundEffectsEnabled: row.soundEffectsEnabled };
}
```

- [ ] **Step 4.4: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/db exec vitest run src/settings.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4.5: Commit**

```bash
git add packages/db/src/settings.ts packages/db/src/settings.test.ts
git commit -m "feat(db): partial settings update + soundEffectsEnabled in DTO"
```

---

## Task 5: Sound registry + player module

**Files:**
- Create: `apps/web/src/lib/sound/registry.ts`
- Create: `apps/web/src/lib/sound/player.ts`
- Test: `apps/web/src/lib/sound/player.test.ts`

- [ ] **Step 5.1: Write the registry**

Create `apps/web/src/lib/sound/registry.ts`:
```ts
/**
 * Catalog of UI sound effects. To add a sound: add an enum member, a URL entry
 * below, and drop the matching file in `apps/web/public/sounds/`.
 */
export enum SoundEffect {
  MoveToTrash = "move-to-trash",
  EmptyTrash = "empty-trash",
}

/** Public URL (served from `apps/web/public`) for each effect. */
export const SOUND_URLS: Record<SoundEffect, string> = {
  [SoundEffect.MoveToTrash]: "/sounds/move-to-trash.mp3",
  [SoundEffect.EmptyTrash]: "/sounds/empty-trash.mp3",
};

/** Default playback volume for all effects (0–1). */
export const SOUND_VOLUME = 0.5;
```

- [ ] **Step 5.2: Write the failing player tests**

Create `apps/web/src/lib/sound/player.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundEffect } from "./registry.js";
import { playSound, setSoundEnabled } from "./player.js";

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  volume = 1;
  currentTime = 0;
  playCalls = 0;
  reject = false;
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  play(): Promise<void> {
    this.playCalls++;
    return this.reject ? Promise.reject(new Error("blocked")) : Promise.resolve();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeAudio.instances = [];
  setSoundEnabled(true); // reset module flag for the next test
});

describe("playSound", () => {
  it("constructs an Audio for the effect URL and plays it when enabled", () => {
    vi.stubGlobal("Audio", FakeAudio);
    setSoundEnabled(true);
    playSound(SoundEffect.MoveToTrash);
    expect(FakeAudio.instances).toHaveLength(1);
    expect(FakeAudio.instances[0].src).toContain("move-to-trash");
    expect(FakeAudio.instances[0].playCalls).toBe(1);
  });

  it("does nothing when sounds are disabled", () => {
    vi.stubGlobal("Audio", FakeAudio);
    setSoundEnabled(false);
    playSound(SoundEffect.EmptyTrash);
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it("swallows a rejected play() promise without throwing", () => {
    class RejectingAudio extends FakeAudio {
      override play(): Promise<void> {
        this.playCalls++;
        return Promise.reject(new Error("blocked"));
      }
    }
    vi.stubGlobal("Audio", RejectingAudio);
    setSoundEnabled(true);
    expect(() => playSound(SoundEffect.MoveToTrash)).not.toThrow();
  });
});
```

- [ ] **Step 5.3: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/sound/player.test.ts`
Expected: FAIL with "Cannot find module './player'" (or `playSound is not a function`).

- [ ] **Step 5.4: Implement the player**

Create `apps/web/src/lib/sound/player.ts`:
```ts
import { SOUND_URLS, SOUND_VOLUME, type SoundEffect } from "./registry.js";

// Module-level mirror of the persisted "sound effects" setting. Defaults on;
// SoundSettingsProvider syncs it to the DB value after mount.
let enabled = true;

/** Update whether sound effects play. Called by SoundSettingsProvider + the toggle. */
export function setSoundEnabled(value: boolean): void {
  enabled = value;
}

/**
 * Play a UI sound effect. No-op when disabled or off the client. Creates a fresh
 * Audio per call (the file is HTTP-cached after first play), which keeps it
 * testable and lets rapid triggers overlap. All playback errors — autoplay-policy
 * rejections, decode failures — are swallowed so a sound can never break an action.
 */
export function playSound(effect: SoundEffect): void {
  if (!enabled) return;
  if (typeof Audio === "undefined") return; // SSR / non-DOM
  const audio = new Audio(SOUND_URLS[effect]);
  audio.volume = SOUND_VOLUME;
  void audio.play().catch(() => {});
}
```

- [ ] **Step 5.5: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/sound/player.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5.6: Commit**

```bash
git add apps/web/src/lib/sound/registry.ts apps/web/src/lib/sound/player.ts apps/web/src/lib/sound/player.test.ts
git commit -m "feat(web): reusable sound registry + player"
```

---

## Task 6: Sound settings provider + layout wiring

**Files:**
- Create: `apps/web/src/components/sound-settings-provider.tsx`
- Modify: `apps/web/src/app/(app)/layout.tsx`

- [ ] **Step 6.1: Create the provider**

Create `apps/web/src/components/sound-settings-provider.tsx`:
```tsx
"use client";

import { useEffect } from "react";
import { setSoundEnabled } from "@/lib/sound/player";

/**
 * Syncs the client sound player's enabled flag to the persisted setting.
 * Renders nothing; mounted once in the app layout, seeded from the DB value.
 */
export function SoundSettingsProvider({ enabled }: { enabled: boolean }) {
  useEffect(() => {
    setSoundEnabled(enabled);
  }, [enabled]);
  return null;
}
```

- [ ] **Step 6.2: Mount it in the app layout**

Edit `apps/web/src/app/(app)/layout.tsx` to read settings and render the provider. Replace the file with:
```tsx
import { redirect } from "next/navigation";
import { getSettings } from "@lumio/db";
import { AppSidebar } from "@/components/app-sidebar";
import { SoundSettingsProvider } from "@/components/sound-settings-provider";
import { getServerSession } from "@/lib/server-session";

export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getServerSession();
  if (!session) redirect("/login");

  const settings = await getSettings();

  return (
    <>
      <SoundSettingsProvider enabled={settings.soundEffectsEnabled} />
      {/* Sidebar is fixed (not in flow); offset content by its 76px width. */}
      <AppSidebar />
      <div className="min-h-dvh pl-[76px]">{children}</div>
    </>
  );
}
```

- [ ] **Step 6.3: Typecheck the web app**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors. (Requires Task 2.5's `pnpm db:generate` to have run so `getSettings` returns `soundEffectsEnabled`. If the human hasn't applied the migration yet, this step shows the expected transient error on `settings.soundEffectsEnabled` — note it and proceed; it resolves after generate.)

- [ ] **Step 6.4: Commit**

```bash
git add apps/web/src/components/sound-settings-provider.tsx "apps/web/src/app/(app)/layout.tsx"
git commit -m "feat(web): hydrate sound player from settings in app layout"
```

---

## Task 7: Settings UI — "Preferences" tab + toggle

**Files:**
- Create: `apps/web/src/app/(app)/settings/sound-effects-form.tsx`
- Modify: `apps/web/src/app/(app)/settings/page.tsx`

- [ ] **Step 7.1: Create the toggle form**

Create `apps/web/src/app/(app)/settings/sound-effects-form.tsx`:
```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setSoundEnabled } from "@/lib/sound/player";
import { Switch } from "@/components/ui/switch";
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field";

export function SoundEffectsForm({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial);
  const [error, setError] = useState(false);

  async function toggle(next: boolean) {
    // Optimistic: flip the UI and the live player immediately.
    setEnabled(next);
    setSoundEnabled(next);
    setError(false);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soundEffectsEnabled: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      // Revert UI + player on failure.
      setEnabled(!next);
      setSoundEnabled(!next);
      setError(true);
    }
  }

  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor="soundEffects">Sound effects</FieldLabel>
        <FieldDescription>
          Play a sound when moving photos to Trash, emptying Trash, or deleting
          permanently.
        </FieldDescription>
        {error && (
          <FieldDescription className="text-destructive">
            Couldn&apos;t save — try again.
          </FieldDescription>
        )}
      </FieldContent>
      <Switch id="soundEffects" checked={enabled} onCheckedChange={toggle} />
    </Field>
  );
}
```

- [ ] **Step 7.2: Add the "Preferences" tab to the settings page**

In `apps/web/src/app/(app)/settings/page.tsx`:

(a) Add the import near the other settings imports (after the `UploadTemplateForm` import on line 23):
```tsx
import { SoundEffectsForm } from "./sound-effects-form";
```

(b) Add a trigger in the `TabsList` — change:
```tsx
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="uploads">Uploads</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>
```
to:
```tsx
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="uploads">Uploads</TabsTrigger>
          <TabsTrigger value="preferences">Preferences</TabsTrigger>
          <TabsTrigger value="danger">Danger zone</TabsTrigger>
        </TabsList>
```

(c) Add the tab content immediately after the closing `</TabsContent>` of the `uploads` tab (after line 136) and before the `danger` `<TabsContent>`:
```tsx
        <TabsContent value="preferences">
          <Card>
            <CardHeader>
              <CardTitle>Preferences</CardTitle>
              <CardDescription>
                Interface preferences for this Lumio install.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SoundEffectsForm initial={settings.soundEffectsEnabled} />
            </CardContent>
          </Card>
        </TabsContent>
```

- [ ] **Step 7.3: Typecheck the web app**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors (assuming Task 2.5 generate has run; otherwise the transient `settings.soundEffectsEnabled` error noted in Task 6.3).

- [ ] **Step 7.4: Commit**

```bash
git add "apps/web/src/app/(app)/settings/sound-effects-form.tsx" "apps/web/src/app/(app)/settings/page.tsx"
git commit -m "feat(web): Sound effects toggle in a Preferences settings tab"
```

---

## Task 8: Play move-to-trash sound

**Files:**
- Modify: `apps/web/src/components/photo-actions/use-photo-actions.tsx`

- [ ] **Step 8.1: Add the import**

In `apps/web/src/components/photo-actions/use-photo-actions.tsx`, add after the existing `@/components/photo-grid/photo-grid` import (line 10):
```tsx
import { playSound } from "@/lib/sound/player";
import { SoundEffect } from "@/lib/sound/registry";
```

- [ ] **Step 8.2: Play on successful trash**

In the `trash` callback's success path, change:
```tsx
        if (!res.ok) throw new Error("trash failed");
        gridRef.current?.removePhotos(new Set(ids));
        onTrashed?.(ids);
        opts?.onSuccess?.();
```
to:
```tsx
        if (!res.ok) throw new Error("trash failed");
        gridRef.current?.removePhotos(new Set(ids));
        playSound(SoundEffect.MoveToTrash);
        onTrashed?.(ids);
        opts?.onSuccess?.();
```

- [ ] **Step 8.3: Verify the existing tests still pass**

Run: `pnpm --filter @lumio/web exec vitest run`
Expected: PASS (no regressions; `playSound` is a no-op under the node test env since `Audio` is undefined).

- [ ] **Step 8.4: Commit**

```bash
git add apps/web/src/components/photo-actions/use-photo-actions.tsx
git commit -m "feat(web): play move-to-trash sound on trash success"
```

---

## Task 9: Play empty-trash sound (empty + purge)

**Files:**
- Modify: `apps/web/src/app/(app)/trash/trash-view.tsx`

- [ ] **Step 9.1: Add the import**

In `apps/web/src/app/(app)/trash/trash-view.tsx`, add after the `@/components/ui/empty` import block (after line 23):
```tsx
import { playSound } from "@/lib/sound/player";
import { SoundEffect } from "@/lib/sound/registry";
```

- [ ] **Step 9.2: Play when the empty-trash job completes**

In the `emptyTrash` job's `onComplete`, change:
```tsx
    onComplete: () => {
      setReloadKey((k) => k + 1);
      sel.clear();
    },
```
to:
```tsx
    onComplete: () => {
      playSound(SoundEffect.EmptyTrash);
      setReloadKey((k) => k + 1);
      sel.clear();
    },
```

- [ ] **Step 9.3: Give `act()` an optional success hook**

Change the `act` signature and success path. Replace:
```tsx
  async function act(
    url: string,
    body: object | null,
    confirmOpts: ConfirmOptions | null,
    failMsg: string,
    remount: boolean,
  ) {
    if (pending) return;
    if (confirmOpts && !(await confirm(confirmOpts))) return;
    const selectedIds = sel.selected;
    setPending(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error("request failed");
      if (remount) setReloadKey((k) => k + 1);
      else gridRef.current?.removePhotos(selectedIds);
      sel.clear();
    } catch {
      toast.error(failMsg);
    } finally {
      setPending(false);
    }
  }
```
with:
```tsx
  async function act(
    url: string,
    body: object | null,
    confirmOpts: ConfirmOptions | null,
    failMsg: string,
    remount: boolean,
    onSuccess?: () => void,
  ) {
    if (pending) return;
    if (confirmOpts && !(await confirm(confirmOpts))) return;
    const selectedIds = sel.selected;
    setPending(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error("request failed");
      if (remount) setReloadKey((k) => k + 1);
      else gridRef.current?.removePhotos(selectedIds);
      onSuccess?.();
      sel.clear();
    } catch {
      toast.error(failMsg);
    } finally {
      setPending(false);
    }
  }
```

- [ ] **Step 9.4: Pass the sound only from the purge button**

In the "Delete permanently" button's `onClick`, change the `act(...)` call:
```tsx
                  onClick={() =>
                    void act(
                      "/api/trash/purge",
                      { ids },
                      {
                        title: `Permanently delete ${label}?`,
                        description: "This can't be undone — the photos and their files are removed for good.",
                        confirmLabel: "Delete permanently",
                        destructive: true,
                      },
                      "Failed to delete photos.",
                      false,
                    )
                  }
```
to:
```tsx
                  onClick={() =>
                    void act(
                      "/api/trash/purge",
                      { ids },
                      {
                        title: `Permanently delete ${label}?`,
                        description: "This can't be undone — the photos and their files are removed for good.",
                        confirmLabel: "Delete permanently",
                        destructive: true,
                      },
                      "Failed to delete photos.",
                      false,
                      () => playSound(SoundEffect.EmptyTrash),
                    )
                  }
```
(Leave the "Restore" button's `act(...)` call unchanged — restore makes no sound.)

- [ ] **Step 9.5: Verify tests still pass**

Run: `pnpm --filter @lumio/web exec vitest run`
Expected: PASS (no regressions).

- [ ] **Step 9.6: Commit**

```bash
git add "apps/web/src/app/(app)/trash/trash-view.tsx"
git commit -m "feat(web): play empty-trash sound on empty + permanent delete"
```

---

## Task 10: Full verification

- [ ] **Step 10.1: Run the whole test suite**

Run: `pnpm test`
Expected: all packages pass, including the new `player.test.ts` and `settings.test.ts`.

- [ ] **Step 10.2: Production build of the web app**

Run: `pnpm --filter @lumio/web build`
Expected: build succeeds with no type errors. (Requires the migration to have been applied + `pnpm db:generate` run — Task 2.4/2.5.)

- [ ] **Step 10.3: Manual browser verification**

Confirm the DB is up (`pnpm db:up`), start dev (`pnpm dev`), and verify, with sound on:
- Move-to-trash from the library grid (toolbar + right-click context menu) → `move-to-trash` plays on success.
- Trash page → "Empty trash" → `empty-trash` plays when the job completes.
- Trash page → select → "Delete permanently" → `empty-trash` plays on success.
- Trash page → "Restore" → **no** sound.
- Settings → Preferences → toggle **off** → repeat a trash action → **no** sound; reload the page → toggle persists off. Toggle back **on** → sound returns.

- [ ] **Step 10.4: Final commit (only if Step 10.3 surfaced fixes)**

```bash
git add -A
git commit -m "fix(web): sound-effects verification follow-ups"
```

---

## Notes / gotchas

- **AIFF won't play in Chrome/Firefox** — that's why Task 1 converts to MP3. Do not reference the `.aif` files at runtime.
- **Node test env:** `apps/web` Vitest runs in the `node` environment (no DOM), so `Audio` is undefined and `playSound` is a safe no-op in tests — the player tests stub `Audio` via `vi.stubGlobal`.
- **Shared DB:** only Task 2 touches it, additively. Never `migrate dev`/`reset`.
- **React Compiler lint:** all new client files start with `"use client"` on line 1; the provider mutates the module flag inside an effect (not during render).
