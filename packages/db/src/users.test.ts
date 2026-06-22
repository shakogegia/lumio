import { describe, expect, it } from "vitest";
import { countUsers, hasAnyUser, listUsers } from "./users.js";

function fakeDb(count: number) {
  const calls: unknown[] = [];
  return {
    calls,
    user: {
      count: async (args?: unknown) => {
        calls.push(args);
        return count;
      },
    },
  };
}

describe("countUsers", () => {
  it("returns the user table count", async () => {
    const db = fakeDb(3);
    expect(await countUsers(db as never)).toBe(3);
    expect(db.calls).toHaveLength(1);
  });
});

describe("hasAnyUser", () => {
  it("is false when there are zero users", async () => {
    expect(await hasAnyUser(fakeDb(0) as never)).toBe(false);
  });

  it("is true when at least one user exists", async () => {
    expect(await hasAnyUser(fakeDb(1) as never)).toBe(true);
  });
});

describe("listUsers", () => {
  it("maps rows to a serializable shape ordered by the query", async () => {
    const rows = [
      {
        id: "u1",
        name: "Ada",
        email: "ada@example.com",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        twoFactorEnabled: true,
      },
    ];
    const db = {
      user: {
        findMany: async (args: unknown) => {
          // The query selects the four columns and orders by createdAt asc.
          expect(args).toMatchObject({
            select: { id: true, name: true, email: true, createdAt: true, twoFactorEnabled: true },
            orderBy: { createdAt: "asc" },
          });
          return rows;
        },
      },
    };
    const result = await listUsers(db as never);
    expect(result).toEqual(rows);
  });
});
