import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addPhotosToAlbum,
  favoritePhotos,
  removePhotoFromAlbum,
  setPhotoColorLabel,
  trashPhotos,
} from "./photo-mutations.js";

function mockFetch(ok = true, body: unknown = {}) {
  const fn = vi.fn(async () => ({ ok, json: async () => body }) as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe("photo-mutations", () => {
  it("favoritePhotos POSTs ids + flag", async () => {
    const f = mockFetch();
    await favoritePhotos("fam", ["a", "b"], true);
    expect(f).toHaveBeenCalledWith("/api/c/fam/photos/favorite", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ photoIds: ["a", "b"], isFavorite: true }),
    }));
  });

  it("setPhotoColorLabel POSTs ids + label", async () => {
    const f = mockFetch();
    await setPhotoColorLabel("fam", ["a"], "pink");
    expect(f).toHaveBeenCalledWith("/api/c/fam/photos/color-label", expect.objectContaining({
      body: JSON.stringify({ photoIds: ["a"], label: "pink" }),
    }));
  });

  it("trashPhotos POSTs ids", async () => {
    const f = mockFetch();
    await trashPhotos("fam", ["a"]);
    expect(f).toHaveBeenCalledWith("/api/c/fam/photos/trash", expect.objectContaining({
      body: JSON.stringify({ ids: ["a"] }),
    }));
  });

  it("addPhotosToAlbum POSTs to the album", async () => {
    const f = mockFetch();
    await addPhotosToAlbum("fam", "alb1", ["a", "b"]);
    expect(f).toHaveBeenCalledWith("/api/c/fam/albums/alb1/photos", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ photoIds: ["a", "b"] }),
    }));
  });

  it("removePhotoFromAlbum DELETEs the member", async () => {
    const f = mockFetch();
    await removePhotoFromAlbum("fam", "alb1", "a");
    expect(f).toHaveBeenCalledWith("/api/c/fam/albums/alb1/photos/a", expect.objectContaining({ method: "DELETE" }));
  });

  it("throws on a non-OK response", async () => {
    mockFetch(false);
    await expect(favoritePhotos("fam", ["a"], true)).rejects.toThrow();
  });
});
