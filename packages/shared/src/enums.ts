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

/** Supported smart-album rule operators (evaluation engine is a follow-up). */
export enum RuleOp {
  eq = "eq",
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
