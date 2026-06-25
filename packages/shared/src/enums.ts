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
