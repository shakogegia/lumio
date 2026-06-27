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
    fileModifiedAt: row.fileModifiedAt.toISOString(),
    fileCreatedAt: row.fileCreatedAt.toISOString(),
    width: row.width,
    height: row.height,
    fileSize: row.fileSize,
    hash: row.hash,
    thumbhash: row.thumbhash,
    exif: (row.exif ?? {}) as ExifData,
    colorLabel: row.colorLabel as ColorLabel | null,
    edits: coercePhotoEdits(row.edits),
    asShotTempK: row.asShotTempK,
    asShotTint: row.asShotTint,
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
    fileModifiedAt: null, // TrashedPhoto has no file-stat columns
    fileCreatedAt: null, // TrashedPhoto has no file-stat columns
    width: row.width,
    height: row.height,
    fileSize: null, // TrashedPhoto has no file-stat columns
    hash: row.hash,
    thumbhash: row.thumbhash,
    exif: (row.exif ?? {}) as ExifData,
    colorLabel: row.colorLabel as ColorLabel | null,
    edits: null,
    asShotTempK: null,
    asShotTint: null,
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
