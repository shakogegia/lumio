import { describe, expect, it, vi } from "vitest";
import {
  createShareLink,
  deleteShareLinkChecked,
  ShareLinkNotFoundError,
} from "./share-links-service.js";

const CAT = "cat1";
const BASE = "https://x.test";

function fakeDb(over: Record<string, unknown> = {}) {
  return {
    shareLink: {
      create: vi.fn().mockResolvedValue({
        id: "s1",
        token: "TOKEN",
        catalogId: CAT,
        title: "T",
        passwordHash: null,
        expiresAt: null,
        createdAt: new Date("2026-06-01T00:00:00Z"),
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    shareLinkPhoto: { findUnique: vi.fn() },
    photo: {
      findMany: vi.fn().mockResolvedValue([{ id: "p1" }, { id: "p2" }]),
      count: vi.fn().mockResolvedValue(2),
      findFirst: vi.fn().mockResolvedValue({ id: "p1" }),
    },
    ...over,
  };
}

describe("createShareLink", () => {
  it("generates a token, links only catalog-owned photos, and returns an absolute URL", async () => {
    const db = fakeDb();
    const deps = {
      generateToken: () => "TOKEN",
      hashPassword: vi.fn(),
    };
    const dto = await createShareLink(
      CAT,
      { photoIds: ["p1", "p2", "pX"], title: "T" },
      { baseUrl: BASE },
      db as never,
      deps as never,
    );
    expect(dto.token).toBe("TOKEN");
    expect(dto.url).toBe("https://x.test/share/TOKEN");
    expect(dto.hasPassword).toBe(false);
    const createArg = (db.shareLink.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.data.photos.create).toEqual([{ photoId: "p1" }, { photoId: "p2" }]);
    expect(deps.hashPassword).not.toHaveBeenCalled();
  });

  it("hashes a password when provided", async () => {
    const db = fakeDb({
      shareLink: {
        create: vi.fn().mockResolvedValue({
          id: "s1", token: "TOKEN", catalogId: CAT, title: null,
          passwordHash: "h", expiresAt: null, createdAt: new Date(),
        }),
        deleteMany: vi.fn(),
      },
    });
    const deps = { generateToken: () => "TOKEN", hashPassword: vi.fn().mockResolvedValue("h") };
    const dto = await createShareLink(CAT, { photoIds: ["p1"], password: "pw" }, { baseUrl: BASE }, db as never, deps as never);
    expect(deps.hashPassword).toHaveBeenCalledWith("pw");
    expect(dto.hasPassword).toBe(true);
  });
});

describe("deleteShareLinkChecked", () => {
  it("throws ShareLinkNotFoundError when nothing was deleted", async () => {
    const db = fakeDb({ shareLink: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    await expect(deleteShareLinkChecked(CAT, "missing", db as never)).rejects.toBeInstanceOf(
      ShareLinkNotFoundError,
    );
  });
});
