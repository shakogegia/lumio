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
