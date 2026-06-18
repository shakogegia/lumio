import { describe, expect, it } from "vitest";
import { countUsers, hasAnyUser } from "./users.js";

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
