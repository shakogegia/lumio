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

/** A registered user, reduced to the columns the Users list renders. */
export interface UserRow {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  twoFactorEnabled: boolean;
}

/** Every registered user, oldest first, for the read-only Users settings list. */
export function listUsers(
  db: Pick<PrismaClient, "user"> = prisma,
): Promise<UserRow[]> {
  return db.user.findMany({
    select: { id: true, name: true, email: true, createdAt: true, twoFactorEnabled: true },
    orderBy: { createdAt: "asc" },
  });
}
