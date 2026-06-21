# Crop Mode Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the crop+straighten editor behind an explicit **Crop mode** (enter via a button, exit via Done/Cancel) instead of showing the crop overlay whenever the Edit tab is open.

**Architecture:** Pure rewiring of existing UI/state — no recipe, bake, geometry, or endpoint changes. The edit session gains a `cropMode` flag + enter/done/cancel; the lightbox center picks one of three render states (interactive crop / read-only pending-crop framing / snappy baked+delta); the crop overlay gains a non-interactive mode; the Edit panel shows a normal body (rotate/flip + a Crop button) or a crop-mode body (straighten + aspect chips + Done/Cancel).

**Tech Stack:** Next.js App Router, React (React Compiler enabled — no synchronous setState in effect bodies; `"use client"` line 1), shadcn/Radix, Tailwind.

**Reference spec:** `docs/superpowers/specs/2026-06-21-crop-mode-toggle-design.md`

**Verify command (all tasks):** `pnpm --filter @lumio/web lint` — confirm NO new errors in the touched file(s). Known pre-existing lint errors (ignore): `use-activity.ts`, `use-async-job.ts`, `library-tree.tsx`/`use-rename-folder-dialog.tsx`, `add-to-album-dialog.tsx`. Browser-verify is a final consolidated pass (don't run the dev server in tasks).

---

## Task 1: Edit session — `cropMode` + enter/done/cancel

**Files:**
- Modify: `apps/web/src/components/photo-grid/use-edit-session.tsx`

- [ ] **Step 1: Extend the `EditSessionValue` interface**
Add these fields (next to the existing `editing`/`setEditing`):
```ts
  /** True while the focused Crop mode is active. */
  cropMode: boolean;
  /** Enter Crop mode (snapshots crop+straighten for Cancel). */
  enterCropMode: () => void;
  /** Exit Crop mode, keeping the crop/straighten in the working recipe (pending Apply). */
  doneCropMode: () => void;
  /** Exit Crop mode, reverting crop+straighten to the pre-enter snapshot. */
  cancelCropMode: () => void;
```

- [ ] **Step 2: Add state + a snapshot ref**
After the existing `const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);` add:
```ts
  const [cropMode, setCropMode] = useState(false);
  const cropSnapshot = useRef<PhotoEdits | null>(null);
```

- [ ] **Step 3: Reset `cropMode` on photo navigation**
In the photo-change effect's local `reseed` function (which already calls `setHistory` + `setBaseSize(null)`), add `setCropMode(false);` so it becomes:
```ts
    const reseed = (e: PhotoEdits) => {
      setHistory(freshHistory(e));
      setBaseSize(null);
      setCropMode(false);
    };
```

- [ ] **Step 4: Add the three callbacks**
Place them after the `setAspect` callback:
```ts
  const enterCropMode = useCallback(() => {
    cropSnapshot.current = working;
    setCropMode(true);
  }, [working]);
  const doneCropMode = useCallback(() => setCropMode(false), []);
  const cancelCropMode = useCallback(() => {
    const snap = cropSnapshot.current;
    // Restore the crop+straighten captured on enter (rotate/flip can't change in
    // crop mode, so restoring the whole snapshot recipe is equivalent and simpler).
    if (snap) setHistory((h) => pushHistory(h, snap));
    setCropMode(false);
  }, []);
```

- [ ] **Step 5: Expose the new values**
Add `cropMode, enterCropMode, doneCropMode, cancelCropMode` to the `value` object passed to the context provider.

- [ ] **Step 6: Verify**
Run `pnpm --filter @lumio/web lint` → no new errors in `use-edit-session.tsx`. (The effect change keeps `setCropMode` inside the local `reseed` fn — no direct setState-in-effect.)

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/components/photo-grid/use-edit-session.tsx
git commit -m "feat(web): crop mode state — enter/done/cancel + snapshot"
```

---

## Task 2: Crop overlay — non-interactive mode

**Files:**
- Modify: `apps/web/src/components/photo-grid/crop-overlay.tsx`

- [ ] **Step 1: Add an `interactive` prop**
Add `interactive = true` to the destructured props and its type:
```ts
export function CropOverlay({
  stageW,
  stageH,
  wo,
  ho,
  deg,
  crop,
  ratio,
  onCommit,
  interactive = true,
}: {
  stageW: number;
  stageH: number;
  wo: number;
  ho: number;
  deg: number;
  crop: CropRect | null;
  ratio: number | null;
  onCommit: (c: CropRect) => void;
  interactive?: boolean;
}) {
```

- [ ] **Step 2: Drop pointer handlers + handles + move cursor when not interactive**
Replace the wrapper div's handler props so they're only attached when interactive — change the opening tag of the returned root `<div className="absolute inset-0" ...>` to:
```tsx
    <div
      className="absolute inset-0"
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerCancel : undefined}
    >
```
On the crop-frame div, make the move affordance conditional — change its props to:
```tsx
      <div
        className="absolute border border-white/90"
        data-handle={interactive ? "move" : undefined}
        style={{ left: px(rect.x), top: px(rect.y), width: px(rect.w), height: px(rect.h), cursor: interactive ? "move" : "default" }}
        onPointerDown={interactive ? onPointerDown : undefined}
      >
```
And render the 8 resize handles only when interactive — wrap the `{(["nw", ...] as Handle[]).map(...)}` block in `{interactive && ( ... )}`:
```tsx
        {interactive &&
          (["nw", "ne", "sw", "se", "n", "s", "e", "w"] as Handle[]).map((h) => (
            <span
              key={h}
              data-handle={h}
              onPointerDown={onPointerDown}
              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 border-white bg-black/40"
              style={handleStyle(h)}
            />
          ))}
```
Leave the dim surround and rule-of-thirds as-is (they render in both modes). The `useCallback` handlers and `stateRef` effect stay defined regardless (hooks must run unconditionally) — they're simply not wired up when `interactive` is false.

- [ ] **Step 3: Verify**
Run `pnpm --filter @lumio/web lint` → no new errors in `crop-overlay.tsx`.

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/components/photo-grid/crop-overlay.tsx
git commit -m "feat(web): crop overlay read-only (non-interactive) mode"
```

---

## Task 3: Lightbox center — 3-way canvas selection

**Files:**
- Modify: `apps/web/src/components/photo-grid/zoomable-image.tsx`

- [ ] **Step 1: Read `cropMode` from the session**
Change the session destructure (currently `const { working, editing, setBaseSize } = useEditSession();`) to:
```ts
  const { working, editing, cropMode, setBaseSize } = useEditSession();
```

- [ ] **Step 2: Compute `pendingGeom`**
The read-only framing preview shows only when crop/straighten differ from what's baked (`shown.recipe`). Add this near the other derived values (after `shown` and the `t = previewTransform(...)` line, anywhere before the `return`):
```ts
  // Crop/straighten differ from the displayed (baked) rendition — the rotate/flip
  // CSS delta can't represent that, so we render the edit-base instead.
  const wc = working.crop ?? null;
  const sc = shown.recipe.crop ?? null;
  const cropSame =
    (!wc && !sc) || (!!wc && !!sc && wc.x === sc.x && wc.y === sc.y && wc.w === sc.w && wc.h === sc.h);
  const pendingGeom =
    (working.straighten ?? 0) !== (shown.recipe.straighten ?? 0) || !cropSame;
```

- [ ] **Step 3: Replace the `editing ? EditorCanvas : <delta block>` conditional with a 3-way choice**
Change the opening of the conditional (currently `{editing ? (\n  <EditorCanvas src={editBaseSrc} onBaseSize={setBaseSize} />\n) : (`) to:
```tsx
        {cropMode ? (
          <EditorCanvas src={editBaseSrc} onBaseSize={setBaseSize} interactive />
        ) : editing && pendingGeom ? (
          <EditorCanvas src={editBaseSrc} onBaseSize={setBaseSize} interactive={false} />
        ) : (
```
The `<div ref={containerRef} ...>` baked+delta block in the final branch is unchanged, and the closing `)}` + NavArrows stay as-is.

- [ ] **Step 4: Thread `interactive` through `EditorCanvas`**
Update `EditorCanvas`'s signature and the `CropOverlay` it renders:
```tsx
function EditorCanvas({
  src,
  onBaseSize,
  interactive,
}: {
  src: string;
  onBaseSize: (s: { w: number; h: number }) => void;
  interactive: boolean;
}) {
```
and pass it to the overlay (add the prop to the existing `<CropOverlay ... />`):
```tsx
          <CropOverlay
            stageW={layout.stageW}
            stageH={layout.stageH}
            wo={orientedBase!.w}
            ho={orientedBase!.h}
            deg={theta}
            crop={effectiveCrop}
            ratio={null}
            interactive={interactive}
            onCommit={(c) => setCrop(c)}
          />
```

- [ ] **Step 5: Verify**
Run `pnpm --filter @lumio/web lint` → no new errors in `zoomable-image.tsx`. Sanity-check the non-editing path (the final `<div ref={containerRef}>` branch) is unchanged.

- [ ] **Step 6: Commit**
```bash
git add apps/web/src/components/photo-grid/zoomable-image.tsx
git commit -m "feat(web): 3-way lightbox canvas (crop / pending-framing / baked-delta)"
```

---

## Task 4: Edit panel — normal vs crop-mode bodies

**Files:**
- Modify: `apps/web/src/components/photo-grid/lightbox-edit-panel.tsx`

- [ ] **Step 1: Imports + session fields**
Add `Crop` and `X` to the lucide import. Add the new session fields to the destructure: `cropMode, enterCropMode, doneCropMode, cancelCropMode` (keep all existing fields).

- [ ] **Step 2: Branch the panel body on `cropMode`**
Replace the entire returned JSX (the `<div className="flex flex-1 flex-col gap-4"> ... </div>`) with a conditional that renders the crop-mode body or the normal body. Keep the `useEditKeyboard` and the `setEditing` mount effect above the return exactly as they are.

```tsx
  if (cropMode) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium">Straighten</p>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setStraighten(0)}
            >
              {(working.straighten ?? 0).toFixed(0)}°
            </button>
          </div>
          <Slider
            min={-45}
            max={45}
            step={1}
            value={[working.straighten ?? 0]}
            onValueChange={(v) => setStraighten(v[0])}
          />
        </div>

        <div className="space-y-2">
          <p className="font-medium">Crop</p>
          <div className="flex flex-wrap gap-1.5">
            {ASPECTS.map(({ preset, label }) => {
              const active = preset === "free" ? working.crop == null : false;
              return (
                <Button
                  key={preset}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => setAspect(preset)}
                >
                  {label}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" disabled={!canUndo} onClick={undo}>
            <Undo2 aria-hidden /> Undo
          </Button>
          <Button variant="outline" size="sm" className="flex-1" disabled={!canRedo} onClick={redo}>
            <Redo2 aria-hidden /> Redo
          </Button>
        </div>

        <div className="mt-auto flex gap-2">
          <Button size="sm" className="flex-1" onClick={doneCropMode}>
            <Check aria-hidden /> Done
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={cancelCropMode}>
            <X aria-hidden /> Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" disabled={!dirty || applying} onClick={() => void apply()}>
          {applying ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          {applying ? "Applying…" : "Apply"}
          <Kbd className="ml-auto bg-primary-foreground/15 text-primary-foreground">⌘S</Kbd>
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          disabled={!hasEdits(working) || applying}
          onClick={reset}
        >
          Reset
        </Button>
      </div>

      <div className="space-y-2">
        <p className="font-medium">Transform</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={rotateLeft}>
            <RotateCcw aria-hidden /> Left
            <Kbd className="ml-auto">[</Kbd>
          </Button>
          <Button variant="outline" size="sm" onClick={rotateRight}>
            <RotateCw aria-hidden /> Right
            <Kbd className="ml-auto">]</Kbd>
          </Button>
          <Button variant="outline" size="sm" onClick={flipH}>
            <FlipHorizontal aria-hidden /> Horizontal
          </Button>
          <Button variant="outline" size="sm" onClick={flipV}>
            <FlipVertical aria-hidden /> Vertical
          </Button>
        </div>
      </div>

      <Button variant="outline" size="sm" className="w-full" onClick={enterCropMode}>
        <Crop aria-hidden /> Crop &amp; Straighten
      </Button>

      <div className="mt-auto flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" disabled={!canUndo} onClick={undo}>
          <Undo2 aria-hidden /> Undo
        </Button>
        <Button variant="outline" size="sm" className="flex-1" disabled={!canRedo} onClick={redo}>
          <Redo2 aria-hidden /> Redo
        </Button>
      </div>
    </div>
  );
```

(The `ASPECTS` module constant, `useEditKeyboard` call, and `setEditing` effect are unchanged. `setStraighten`/`setAspect` remain destructured — they're now used only in the crop-mode body.)

- [ ] **Step 3: Verify**
Run `pnpm --filter @lumio/web lint` → no new errors in `lightbox-edit-panel.tsx`. Confirm no unused-import/var warnings (every destructured field is still used across the two bodies).

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/components/photo-grid/lightbox-edit-panel.tsx
git commit -m "feat(web): Edit panel — normal body + Crop & Straighten mode (Done/Cancel)"
```

---

## Task 5: Verification

**Files:** none.

- [ ] **Step 1: Lint + the test suite**
```bash
pnpm --filter @lumio/web lint   # no new errors in the four touched files
pnpm -r test                    # all packages still green (no logic changed, but confirm)
```

- [ ] **Step 2: Browser-verify** (controller/user, against the running dev server)
- Edit tab opens with NO crop overlay; rotate/flip + zoom work.
- "Crop & Straighten" → enters crop mode: interactive overlay + straighten slider + aspect chips + Done/Cancel.
- Adjust crop/straighten → **Done** → overlay gone, the pending crop shows read-only (dimmed framing, no handles).
- **Apply** → baked; grid tile + lightbox + film strip reflect the crop.
- Re-enter crop → **Cancel** → crop/straighten revert to the enter-state; rotate/flip preserved.
- Undo/Redo work in both bodies; discard-on-nav still prompts when dirty.

- [ ] **Step 3: Finish** — use superpowers:finishing-a-development-branch.

---

## Self-review (coverage)
- Spec §3 (session) → Task 1. §4 (3-way canvas) → Task 3. §5 (overlay interactive) → Task 2. §6 (panel bodies) → Task 4. §8 (verify) → Task 5.
- Type consistency: `cropMode`/`enterCropMode`/`doneCropMode`/`cancelCropMode` defined in Task 1, consumed in Tasks 3 (cropMode) and 4 (all). `interactive` prop defined in Task 2, threaded in Task 3. `pendingGeom` local to Task 3.
- No placeholders; every step has concrete code.
