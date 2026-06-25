import type { Prisma } from "@lumio/db";

/**
 * Where-fragment selecting only LIVE photos (not pending-trash). A photo marked
 * `trashedAt` is awaiting the worker's finalize and must not appear in any
 * user-facing list/count/cover. Spread (`...LIVE_PHOTO`) into every live-photo
 * query. The trash/finalize/restore/purge paths deliberately omit it.
 */
export const LIVE_PHOTO = { trashedAt: null } satisfies Prisma.PhotoWhereInput;
