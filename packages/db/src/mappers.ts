import type { Album, Folder, Photo, TrashedPhoto } from "@prisma/client";
import {
  type AlbumDTO,
  type ColorLabel,
  coercePhotoEdits,
  type ExifData,
  type FolderDTO,
  PhotoSource,
  type PhotoDTO,
  type SmartAlbumRules,
} from "@lumio/shared";

export function toPhotoDTO(row: Photo): PhotoDTO {
  return {
    id: row.id,
    path: row.path,
    source: row.source as PhotoSource,
    takenAt: row.takenAt ? row.takenAt.toISOString() : null,
    width: row.width,
    height: row.height,
    hash: row.hash,
    thumbhash: row.thumbhash,
    exif: (row.exif ?? {}) as ExifData,
    colorLabel: row.colorLabel as ColorLabel | null,
    edits: coercePhotoEdits(row.edits),
    isFavorite: row.isFavorite,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toTrashedPhotoDTO(row: TrashedPhoto): PhotoDTO {
  return {
    id: row.id,
    path: row.originalPath,
    source: row.source as PhotoSource,
    takenAt: row.takenAt ? row.takenAt.toISOString() : null,
    width: row.width,
    height: row.height,
    hash: row.hash,
    thumbhash: row.thumbhash,
    exif: (row.exif ?? {}) as ExifData,
    colorLabel: row.colorLabel as ColorLabel | null,
    edits: null,
    isFavorite: false,
    createdAt: row.deletedAt.toISOString(),
    updatedAt: row.deletedAt.toISOString(),
  };
}

export function toAlbumDTO(row: Album): AlbumDTO {
  return {
    id: row.id,
    name: row.name,
    isSmart: row.isSmart,
    rules: (row.rules as SmartAlbumRules | null) ?? null,
    coverPhotoId: row.coverPhotoId ?? null,
    folderId: row.folderId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toFolderDTO(row: Folder): FolderDTO {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
