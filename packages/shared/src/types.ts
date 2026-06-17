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
