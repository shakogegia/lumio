import type { ColorLabel } from "./color-labels.js";
import type { MatchType, PhotoSource, RuleOp } from "./enums.js";

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
  width: number;
  height: number;
  hash: string | null;
  /** Base64 ThumbHash — a ~25-byte blurred preview shown while the thumbnail loads. */
  thumbhash: string | null;
  exif: ExifData;
  colorLabel: ColorLabel | null;
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
  /** Photo one position earlier in the active sort order (the left arrow target); null at the start. */
  prevId: string | null;
  /** Photo one position later in the active sort order (the right arrow target); null at the end. */
  nextId: string | null;
  /** A window of strip items in the active sort order: [...before, current, ...after]. */
  strip: PhotoStripItem[];
}
