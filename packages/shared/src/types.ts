import type { MatchType, PhotoSource, RuleOp } from "./enums.js";

/** Normalized subset of EXIF we surface to clients. */
export interface ExifData {
  takenAt?: string; // ISO string
  cameraMake?: string;
  cameraModel?: string;
  orientation?: number;
  [key: string]: unknown; // raw passthrough allowed
}

export interface PhotoDTO {
  id: string;
  path: string;
  source: PhotoSource;
  takenAt: string | null; // ISO string
  width: number;
  height: number;
  hash: string | null;
  exif: ExifData;
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
  createdAt: string;
  updatedAt: string;
}

export interface AlbumSummaryDTO extends AlbumDTO {
  photoCount: number;
  coverPhotoId: string | null;
}

/** Minimal photo shape for the film strip — just enough to render a thumbnail. */
export interface PhotoStripItem {
  id: string;
  path: string;
}

/** Neighbors of a photo within a navigation scope (album or whole library). */
export interface PhotoNeighbors {
  /** Photo one position earlier in PHOTO_ORDER (the left arrow target); null at the start. */
  prevId: string | null;
  /** Photo one position later in PHOTO_ORDER (the right arrow target); null at the end. */
  nextId: string | null;
  /** A window of strip items in PHOTO_ORDER: [...before, current, ...after]. */
  strip: PhotoStripItem[];
}
