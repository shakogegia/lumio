/** Where a photo entered the system. Mirrors the Prisma PhotoSource enum 1:1. */
export enum PhotoSource {
  filesystem = "filesystem",
  upload = "upload",
}

/** Smart-album match mode: all rules must pass, or any rule. */
export enum MatchType {
  all = "all",
  any = "any",
}

/** Supported filter/smart-album rule operators (used by buildPhotoWhere). */
export enum RuleOp {
  eq = "eq",
  ne = "ne",
  contains = "contains",
  not_contains = "not_contains",
  gt = "gt",
  gte = "gte",
  lt = "lt",
  lte = "lte",
  between = "between",
  exists = "exists",
  not_exists = "not_exists",
  in_album = "in_album",
  not_in_album = "not_in_album",
  in_list = "in_list",
  not_in_list = "not_in_list",
  last_30_days = "last_30_days",
}

/** Data type of a metadata field. */
export enum FieldType {
  Text = "text",
  Textarea = "textarea",
  Number = "number",
  Choice = "choice",
  Date = "date",
}

/** Whether a field is a built-in standard (EXIF-backed) field or a user-defined one. */
export enum FieldKind {
  Standard = "standard",
  Custom = "custom",
}

/** Where a resolved field's value came from. */
export enum MetadataValueSource {
  Exif = "exif",
  User = "you",
  Empty = "empty",
}
