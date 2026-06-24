import { describe, it, expect, vi } from "vitest";
import { fetchPhotos, thumbnailUrl, displayUrl, originalUrl, setFavorite } from "./photos-api";

describe("fetchPhotos", () => {
  it("requests the catalog photos endpoint with limit/offset and the cookie", async () => {
    const json = vi
      .fn()
      .mockResolvedValue({ items: [{ id: "p1", updatedAt: "t", thumbhash: null }], total: 1 });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json });
    vi.stubGlobal("fetch", fetchMock);

    const page = await fetchPhotos("http://h", "cat", "session=x", { limit: 50, offset: 100 });

    expect(fetchMock).toHaveBeenCalledWith("http://h/api/c/cat/photos?limit=50&offset=100", {
      headers: { accept: "application/json", Cookie: "session=x" },
    });
    expect(page.total).toBe(1);
    expect(page.items[0]?.id).toBe("p1");
  });

  it("throws a reach error when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    await expect(fetchPhotos("http://h", "cat", "c", { limit: 1, offset: 0 })).rejects.toThrow(
      "Couldn't reach the server.",
    );
  });

  it("throws a status error on non-OK", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(fetchPhotos("http://h", "cat", "c", { limit: 1, offset: 0 })).rejects.toThrow(
      "Couldn't load photos (500).",
    );
  });
});

describe("thumbnailUrl", () => {
  it("builds a versioned thumbnail URL", () => {
    const updatedAt = "2026-06-23T00:00:00.000Z";
    expect(thumbnailUrl("http://h", "cat", { id: "p1", updatedAt })).toBe(
      `http://h/api/c/cat/photos/p1/thumbnail?v=${Date.parse(updatedAt)}`,
    );
  });
});

describe("displayUrl", () => {
  it("builds a versioned display URL", () => {
    const updatedAt = "2026-06-23T00:00:00.000Z";
    expect(displayUrl("http://h", "cat", { id: "p1", updatedAt })).toBe(
      `http://h/api/c/cat/photos/p1/display?v=${Date.parse(updatedAt)}`,
    );
  });
});

describe("originalUrl", () => {
  it("builds the original-bytes URL", () => {
    expect(originalUrl("http://h", "cat", { id: "p1" })).toBe(
      "http://h/api/c/cat/photos/p1/original",
    );
  });
});

describe("setFavorite", () => {
  it("posts the favorite toggle with the cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await setFavorite("http://h", "cat", "session=x", "p1", true);

    expect(fetchMock).toHaveBeenCalledWith("http://h/api/c/cat/photos/favorite", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        Cookie: "session=x",
      },
      body: JSON.stringify({ photoIds: ["p1"], isFavorite: true }),
    });
  });

  it("throws on a non-OK status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(setFavorite("http://h", "cat", "c", "p1", false)).rejects.toThrow(
      "Couldn't update favorite (500).",
    );
  });
});
