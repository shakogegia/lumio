import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client.js";

/** Number of registered users. */
export async function countUsers(
  db: Pick<PrismaClient, "user"> = prisma,
): Promise<number> {
  return db.user.count();
}

/** True once at least one account exists (used to close first-run setup). */
export async function hasAnyUser(
  db: Pick<PrismaClient, "user"> = prisma,
): Promise<boolean> {
  return (await countUsers(db)) > 0;
}
