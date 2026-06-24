import type { ColorLabel } from "./color-labels.js";
import type { MatchType, PhotoSource, RuleOp } from "./enums.js";
import type { CurvePoint } from "./tone-curve.js";

export type { CurvePoint };

/** Tone curves: a master (luminance) curve plus optional per-channel R/G/B curves.
 *  Each is a list of control points in [0,1]; absent / <2 points = identity. */
export interface CurveSpec {
  master?: CurvePoint[];
  r?: CurvePoint[];
  g?: CurvePoint[];
  b?: CurvePoint[];
}

/** A crop rectangle, normalized 0..1 against the straightened bounding box O′
 *  (see the crop-geometry module). When straighten is 0, O′ === the oriented
 *  image, so this is simply a fraction of the oriented image. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Non-destructive edit recipe applied on top of EXIF auto-orientation.
 *  Canonical order: flipH → flipV → coarse rotate → straighten(θ) → crop. */
export interface PhotoEdits {
  /** Recipe schema version (see EDITS_VERSION in photo-edits.ts). Absent/<3 in
   *  legacy rows → migrated to current units on read (coercePhotoEdits). Stamped on
   *  every coerced/saved recipe; metadata only, not a visual field (sameEdits ignores it). */
  version?: number;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  /** Fine tilt in degrees, clamped to [-45, 45]. Absent/0 = no straighten. */
  straighten?: number;
  /** Crop rectangle normalized to O′. Absent/null = full frame. */
  crop?: CropRect | null;

  // Color adjustments. All optional; absent === neutral. See photo-color.ts.
  // NOTE: temperature's neutral is 6500 (K), NOT 0 — use NEUTRAL[key] to default.
  /** Exposure in EV stops; applied as a 2^EV multiply in linear light. -5..5, 0 = neutral. */
  exposure?: number;
  /** Midtone-gamma lift/cut (anchors black & white). -100..100, 0 = neutral. */
  brightness?: number;
  /** Contrast around mid-grey. -100..100, 0 = neutral. */
  contrast?: number;
  /** Saturation multiply. -100..100, 0 = neutral. */
  saturation?: number;
  /** White-balance temperature in Kelvin (higher = warmer). 2000..11000, 6500 = neutral (centered). */
  temperature?: number;
  /** White-balance tint, green (−) ↔ magenta (+). -150..150, 0 = neutral. */
  tint?: number;
  /** Hue rotation in degrees. -180..180, 0 = neutral. */
  hue?: number;
  /** Fade: + lifts blacks (matte/wash), − deepens blacks (punch/contrast). -100..100, 0 = neutral. */
  fade?: number;
  /** Vignette: − darkens corners, + lightens. -100..100, 0 = neutral. */
  vignette?: number;
  /** Highlights region brightness (+ brightens, − recovers). -100..100, 0 = neutral. */
  highlights?: number;
  /** Shadows region brightness (+ lifts, − deepens). -100..100, 0 = neutral. */
  shadows?: number;
  /** White point (+ brightens/clips highlights, − compresses). -100..100, 0 = neutral. */
  whites?: number;
  /** Black point (+ lifts blacks, − deepens/clips). -100..100, 0 = neutral. */
  blacks?: number;
  /** Vibrance: saturation weighted toward less-saturated pixels. -100..100, 0 = neutral. */
  vibrance?: number;
  /** Unsharp-mask amount (3×3 high-pass over the source). 0..100, 0 = neutral. */
  sharpen?: number;
  /** Sharpen masking: hold sharpening back in flat areas. 0..100, 0 = neutral. */
  sharpenMask?: number;
  /** Edge-aware noise reduction (blend toward the local mean). 0..100, 0 = neutral. */
  noiseReduction?: number;
  /** Film grain amount (per-pixel hash, applied last). 0..100, 0 = neutral. */
  grain?: number;
  /** Grain cell size; only meaningful when grain > 0. 0..100, 0 = neutral. */
  grainSize?: number;
  /** Tone curves (master + optional per-channel). Absent = identity. */
  curves?: CurveSpec;
}

/** Normalized subset of EXIF we surface to clients. */
export interface ExifData {
  takenAt?: string; // ISO string
  cameraMake?: string;
  cameraModel?: string;
  orientation?: number;
  [key: string]: unknown; // full sanitized metadata dump (all EXIF/GPS/XMP/IPTC tags)
}

export interface PhotoDTO {
  id: string;
  path: string;
  source: PhotoSource;
  takenAt: string | null; // ISO string
  fileModifiedAt: string | null; // ISO string; null for trashed photos (no such column)
  fileCreatedAt: string | null; // ISO string; null for trashed photos (no such column)
  width: number;
  height: number;
  hash: string | null;
  /** Base64 ThumbHash — a ~25-byte blurred preview shown while the thumbnail loads. */
  thumbhash: string | null;
  exif: ExifData;
  colorLabel: ColorLabel | null;
  edits: PhotoEdits | null;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
  albumIds?: string[];
}

export interface SmartAlbumRule {
  field: string; // e.g. "takenAt" | "exif.cameraModel"
  op: RuleOp;
  value?: string | number;
}

export interface SmartAlbumRules {
  match: MatchType;
  rules: SmartAlbumRule[];
}

export interface AlbumDTO {
  id: string;
  name: string;
  isSmart: boolean;
  rules: SmartAlbumRules | null;
  /** The explicitly pinned cover, raw from the row. null = no pin (use derived).
   *  This is the value the album-detail view uses for the "current cover" hint. */
  coverPhotoId: string | null;
  /** The folder this album lives in (null = top level). Drives folder-nested album pickers. */
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlbumSummaryDTO extends AlbumDTO {
  photoCount: number;
  /** The EFFECTIVE cover: the pinned photo if it is still a member, otherwise
   *  the derived most-recent member. Same field name as AlbumDTO, resolved value —
   *  this is what the album grid card and sidebar render as the thumbnail. */
  coverPhotoId: string | null;
}

export interface FolderDTO {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FolderSummaryDTO extends FolderDTO {
  /** Number of DIRECT child folders. */
  childFolderCount: number;
  /** Number of albums anywhere in the subtree (recursive). */
  albumCount: number;
  /** Deduplicated count of photos across every album in the subtree. */
  totalPhotoCount: number;
  /** Up to 4 cover photo ids (canonical order) for the folder-card mosaic. */
  previewPhotoIds: string[];
}

export interface FolderContentsDTO {
  /** The folder being viewed; null at the top level. */
  folder: FolderDTO | null;
  /** Ancestor chain from the top-level folder down to (and including) the viewed folder. Empty at top level. */
  breadcrumbs: FolderDTO[];
  subfolders: FolderSummaryDTO[];
  albums: AlbumSummaryDTO[];
  /** Deduplicated recursive photo count of the viewed folder (for the header subtitle); null at the top level. */
  currentPhotoCount: number | null;
}

/** Minimal photo shape for the film strip — just enough to render a thumbnail. */
export interface PhotoStripItem {
  id: string;
  path: string;
}

/** Neighbors of a photo within a navigation scope (album or whole library). */
export interface PhotoNeighbors {
  /** Photo one position earlier in the active sort order (the left arrow target); null at the start. */
  prevId: string | null;
  /** Photo one position later in the active sort order (the right arrow target); null at the end. */
  nextId: string | null;
  /** A window of strip items in the active sort order: [...before, current, ...after]. */
  strip: PhotoStripItem[];
}
