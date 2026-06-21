import type { ColorLabel } from "./color-labels.js";
import type { MatchType, PhotoSource, RuleOp } from "./enums.js";

/** Non-destructive edit recipe applied on top of EXIF auto-orientation.
 *  Canonical application order: flipH → flipV → rotate (clockwise). */
export interface PhotoEdits {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
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
