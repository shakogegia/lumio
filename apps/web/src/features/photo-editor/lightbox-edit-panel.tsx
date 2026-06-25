"use client";

import { useEffect } from "react";
import {
  Check,
  Crop,
  FlipHorizontal,
  FlipVertical,
  History,
  Loader2,
  RefreshCcw,
  RotateCcw,
  RotateCw,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import { hasEdits, hasColor, COLOR_FIELDS, type AspectPreset, type ColorField } from "@lumio/shared";

const COLOR_GROUP = COLOR_FIELDS.filter((f) => f.group !== "detail");
const DETAIL_GROUP = COLOR_FIELDS.filter((f) => f.group === "detail");
const DETAIL_KEYS = DETAIL_GROUP.map((f) => f.key);
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEditSession } from "./use-edit-session";
import { useEditKeyboard } from "./use-edit-keyboard";
import { CurveEditor } from "./curve-editor";

const ASPECTS: { preset: AspectPreset; label: string }[] = [
  { preset: "free", label: "Free" },
  { preset: "original", label: "Original" },
  { preset: "square", label: "Square" },
  { preset: "5:4", label: "5:4" }, { preset: "4:5", label: "4:5" },
  { preset: "4:3", label: "4:3" }, { preset: "3:4", label: "3:4" },
  { preset: "3:2", label: "3:2" }, { preset: "2:3", label: "2:3" },
  { preset: "16:9", label: "16:9" }, { preset: "9:16", label: "9:16" },
];

/** Tooltipped icon button for a section's "reset to neutral" affordance. The
 *  buttons are icon-only (a circular-arrow glyph), so the tooltip carries what
 *  they reset. No keyboard shortcut — these mirror the per-slider value reset. */
function ResetButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label={label}
          disabled={disabled}
          onClick={onClick}
        >
          <RefreshCcw aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Edit-tab body: rotate/flip controls with undo/redo that drive the lightbox
 *  edit session, plus Apply (persist) and Reset (back to original, on Apply). */
export function LightboxEditPanel() {
  const {
    working,
    baseline,
    dirty,
    applying,
    canUndo,
    canRedo,
    rotateLeft,
    rotateRight,
    flipH,
    flipV,
    reset,
    revertToOriginal,
    undo,
    redo,
    apply,
    setEditing,
    setStraighten,
    setAspect,
    cropAspect,
    resetCrop,
    setColorLive,
    setColor,
    resetTransform,
    resetColor,
    cropMode,
    enterCropMode,
    doneCropMode,
    cancelCropMode,
  } = useEditSession();
  // ⌘S is a no-op in crop mode: applying mid-crop would bake while cropMode stays
  // true and reset history, leaving Done/Cancel acting on a stale snapshot. Exit
  // crop mode (Done) first, then Apply.
  useEditKeyboard({
    rotateLeft,
    rotateRight,
    apply: () => {
      if (!cropMode) void apply();
    },
  });

  useEffect(() => {
    setEditing(true);
    return () => setEditing(false);
  }, [setEditing]);

  const renderSlider = (f: ColorField) => {
    // Temperature/Tint default + reset to the photo's as-shot baseline (their
    // neutral is per-photo); other fields use their global neutral.
    const neutral =
      f.key === "temperature" ? baseline.k
      : f.key === "tint" ? baseline.tint
      : f.neutral;
    const value = working[f.key] ?? neutral;
    return (
      <div key={f.key} className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{f.label}</span>
          <button
            type="button"
            aria-label={`Reset ${f.label}`}
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setColor(f.key, neutral)}
          >
            {f.precision ? value.toFixed(f.precision) : Math.round(value)}
          </button>
        </div>
        <Slider
          min={f.min}
          max={f.max}
          step={f.step}
          value={[value]}
          onValueChange={(v) => setColorLive(f.key, v[0])}
          onValueCommit={(v) => setColor(f.key, v[0])}
        />
      </div>
    );
  };

  if (cropMode) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <div className="flex gap-2">
          <Button size="sm" className="flex-1" onClick={doneCropMode}>
            <Check aria-hidden /> Done
            <Kbd className="ml-auto bg-primary-foreground/15 text-primary-foreground">Enter</Kbd>
          </Button>
          <Button variant="outline" size="sm" className="flex-1" onClick={cancelCropMode}>
            <X aria-hidden /> Cancel
            <Kbd className="ml-auto">Esc</Kbd>
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="font-medium text-muted-foreground">Straighten</p>
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
          <div className="flex items-center justify-between">
            <p className="font-medium text-muted-foreground">Crop</p>
            <ResetButton
              label="Reset crop"
              disabled={working.crop == null}
              onClick={() => setAspect("free")}
            />
          </div>
          {/* A null crop is unconstrained regardless of the remembered preset, so
              Free lights up whenever there is no explicit crop. */}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={working.crop == null ? "free" : cropAspect}
            onValueChange={(v) => {
              // Radix fires "" when the active item is re-clicked; ignore so a chip
              // can't be toggled off into an empty selection.
              if (v) setAspect(v as AspectPreset);
            }}
            className="w-full flex-wrap"
          >
            {ASPECTS.map(({ preset, label }) => (
              <ToggleGroupItem key={preset} value={preset} className="h-7 px-2 text-xs">
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" disabled={!dirty || applying} onClick={() => void apply()}>
          {applying ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
          {applying ? "Applying" : "Apply"}
          <Kbd className="ml-auto bg-primary-foreground/15 text-primary-foreground">⌘S</Kbd>
        </Button>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              disabled={!dirty || applying}
              onClick={reset}
            >
              Reset
            </Button>
          </TooltipTrigger>
          <TooltipContent>Discard unsaved changes</TooltipContent>
        </Tooltip>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-medium text-muted-foreground">Transform</p>
          <ResetButton
            label="Reset transform"
            disabled={working.rotate === 0 && !working.flipH && !working.flipV}
            onClick={resetTransform}
          />
        </div>
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

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="font-medium text-muted-foreground">Crop</p>
          <ResetButton
            label="Reset crop & straighten"
            disabled={working.crop == null && (working.straighten ?? 0) === 0}
            onClick={resetCrop}
          />
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={enterCropMode}>
          <Crop aria-hidden /> Crop &amp; Straighten
          <Kbd className="ml-auto">R</Kbd>
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-medium text-muted-foreground">Adjust</p>
          <ResetButton
            label="Reset adjustments"
            disabled={!hasColor(working)}
            onClick={() => resetColor()}
          />
        </div>
        {COLOR_GROUP.map(renderSlider)}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <p className="font-medium text-muted-foreground">Detail &amp; Grain</p>
          <ResetButton
            label="Reset detail & grain"
            disabled={DETAIL_KEYS.every((k) => (working[k] ?? 0) === 0)}
            onClick={() => resetColor(DETAIL_KEYS)}
          />
        </div>
        {DETAIL_GROUP.map(renderSlider)}
      </div>

      <CurveEditor />

      <div className="mt-auto flex flex-col gap-2">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="flex-1" disabled={!canUndo} onClick={undo}>
            <Undo2 aria-hidden /> Undo
            <Kbd className="ml-auto">⌘Z</Kbd>
          </Button>
          <Button variant="outline" size="sm" className="flex-1" disabled={!canRedo} onClick={redo}>
            <Redo2 aria-hidden /> Redo
            <Kbd className="ml-auto">⌘⇧Z</Kbd>
          </Button>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              disabled={!hasEdits(working) || applying}
              onClick={revertToOriginal}
            >
              <History aria-hidden /> Revert to original
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Remove all edits and return to the unedited photo
          </TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
