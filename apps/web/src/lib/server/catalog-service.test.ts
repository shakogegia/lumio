import { describe, expect, it, vi, beforeEach } from "vitest";
import path from "node:path";

// ── mock @/lib/server/server-paths ─────────────────────────────────────────────────────────
// Use vi.hoisted so the constant is available inside the hoisted vi.mock factory.
const { FAKE_MEDIA_ROOT } = vi.hoisted(() => ({ FAKE_MEDIA_ROOT: "/media" }));

vi.mock("@/lib/server/server-paths", () => ({
  MEDIA_ROOT: FAKE_MEDIA_ROOT,
  CACHE_DIR: "/cache",
  TRASH_DIR: "/trash",
  isInsideMediaRoot: (p: string) => {
    const resolved = path.resolve(p);
    return resolved === FAKE_MEDIA_ROOT || resolved.startsWith(FAKE_MEDIA_ROOT + path.sep);
  },
}));

// ── mock @lumio/db ────────────────────────────────────────────────────────────
const listCatalogsMock = vi.fn();
const getCatalogByIdMock = vi.fn();
const createCatalogMock = vi.fn();
const deleteCatalogMock = vi.fn();

vi.mock("@lumio/db", () => ({
  prisma: {},
  listCatalogs: (...args: unknown[]) => listCatalogsMock(...args),
  getCatalogById: (...args: unknown[]) => getCatalogByIdMock(...args),
  createCatalog: (...args: unknown[]) => createCatalogMock(...args),
  deleteCatalog: (...args: unknown[]) => deleteCatalogMock(...args),
}));

// ── mock @lumio/shared ────────────────────────────────────────────────────────
vi.mock("@lumio/shared", async (importOriginal) => {
  // Use the actual schema so validation logic is real
  const actual = await importOriginal<typeof import("@lumio/shared")>();
  return { ...actual };
});

// ── mock @lumio/jobs ──────────────────────────────────────────────────────────
const purgeAllPhotosMock = vi.fn();
vi.mock("@lumio/jobs", () => ({
  purgeAllPhotos: (...args: unknown[]) => purgeAllPhotosMock(...args),
}));

// ── mock node:fs/promises ─────────────────────────────────────────────────────
const rmMock = vi.fn();
vi.mock("node:fs/promises", () => ({ rm: (...args: unknown[]) => rmMock(...args) }));

import {
  catalogPathConflict,
  createCatalogChecked,
  deleteCatalogWithMode,
} from "./catalog-service.js";

// ─────────────────────────────────────────────────────────────────────────────
// catalogPathConflict — pure logic tests
// ─────────────────────────────────────────────────────────────────────────────
describe("catalogPathConflict", () => {
  it("returns 'outside-root' for a path outside MEDIA_ROOT", () => {
    expect(catalogPathConflict("/tmp/photos", [])).toBe("outside-root");
    expect(catalogPathConflict("/other", ["/media/a"])).toBe("outside-root");
  });

  it("returns null when there are no existing catalogs", () => {
    expect(catalogPathConflict("/media/family", [])).toBeNull();
  });

  it("returns 'overlap' for an exact duplicate path", () => {
    expect(catalogPathConflict("/media/family", ["/media/family"])).toBe("overlap");
  });

  it("returns 'overlap' when new path is nested under an existing catalog", () => {
    // /media/family/vacation is under /media/family
    expect(catalogPathConflict("/media/family/vacation", ["/media/family"])).toBe("overlap");
  });

  it("returns 'overlap' when an existing catalog is nested under the new path", () => {
    // /media/family already exists; new one is /media — would contain it
    expect(catalogPathConflict("/media", ["/media/family"])).toBe("overlap");
  });

  it("returns null for sibling paths that do not overlap", () => {
    expect(catalogPathConflict("/media/family", ["/media/travel", "/media/work"])).toBeNull();
  });

  it("returns 'outside-root' even when existing paths include MEDIA_ROOT children", () => {
    expect(catalogPathConflict("/etc/photos", ["/media/photos"])).toBe("outside-root");
  });

  it("returns null when new path equals MEDIA_ROOT itself (edge: MEDIA_ROOT is valid root)", () => {
    // MEDIA_ROOT itself is inside (or equal to) MEDIA_ROOT per isInsideMediaRoot
    expect(catalogPathConflict("/media", [])).toBeNull();
  });

  it("does not falsely flag paths that share a prefix but are not ancestors", () => {
    // /media/family2 should not overlap with /media/family
    expect(catalogPathConflict("/media/family2", ["/media/family"])).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createCatalogChecked
// ─────────────────────────────────────────────────────────────────────────────
describe("createCatalogChecked", () => {
  beforeEach(() => {
    listCatalogsMock.mockReset();
    createCatalogMock.mockReset();
  });

  it("returns ok:false when name is empty", async () => {
    const result = await createCatalogChecked({ name: "", path: "/media/family" });
    expect(result.ok).toBe(false);
  });

  it("returns ok:false when path is outside MEDIA_ROOT", async () => {
    listCatalogsMock.mockResolvedValue([]);
    const result = await createCatalogChecked({ name: "My Cat", path: "/tmp/photos" });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toMatch(/inside/i);
  });

  it("returns ok:false when path overlaps an existing catalog", async () => {
    listCatalogsMock.mockResolvedValue([{ path: "/media/family" }]);
    const result = await createCatalogChecked({ name: "Sub", path: "/media/family/vacation" });
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.error).toMatch(/overlap/i);
  });

  it("creates and returns the catalog on success", async () => {
    listCatalogsMock.mockResolvedValue([]);
    const catalog = {
      id: "c1",
      name: "Family",
      slug: "family",
      path: "/media/family",
      uploadTemplate: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    createCatalogMock.mockResolvedValue(catalog);
    const result = await createCatalogChecked({ name: "Family", path: "/media/family" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.catalog).toBe(catalog);
    expect(createCatalogMock).toHaveBeenCalledWith({ name: "Family", path: "/media/family" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deleteCatalogWithMode
// ─────────────────────────────────────────────────────────────────────────────
describe("deleteCatalogWithMode", () => {
  beforeEach(() => {
    getCatalogByIdMock.mockReset();
    deleteCatalogMock.mockReset();
    purgeAllPhotosMock.mockReset();
    rmMock.mockReset();
  });

  it("does nothing when catalog is not found", async () => {
    getCatalogByIdMock.mockResolvedValue(null);
    await deleteCatalogWithMode("c1", "detach");
    expect(deleteCatalogMock).not.toHaveBeenCalled();
    expect(rmMock).not.toHaveBeenCalled();
  });

  it("detach mode: does NOT call purgeAllPhotos", async () => {
    getCatalogByIdMock.mockResolvedValue({ id: "c1", path: "/media/family" });
    deleteCatalogMock.mockResolvedValue({});
    rmMock.mockResolvedValue(undefined);
    await deleteCatalogWithMode("c1", "detach");
    expect(purgeAllPhotosMock).not.toHaveBeenCalled();
    expect(deleteCatalogMock).toHaveBeenCalledWith("c1");
    expect(rmMock).toHaveBeenCalledTimes(2);
  });

  it("delete-originals mode: calls purgeAllPhotos before deleteCatalog", async () => {
    getCatalogByIdMock.mockResolvedValue({ id: "c1", path: "/media/family" });
    purgeAllPhotosMock.mockResolvedValue({ deleted: 3 });
    deleteCatalogMock.mockResolvedValue({});
    rmMock.mockResolvedValue(undefined);
    await deleteCatalogWithMode("c1", "delete-originals");
    expect(purgeAllPhotosMock).toHaveBeenCalledWith(
      expect.objectContaining({ catalogId: "c1", photosDir: "/media/family" }),
    );
    expect(deleteCatalogMock).toHaveBeenCalledWith("c1");
    expect(rmMock).toHaveBeenCalledTimes(2);
  });

  it("always cleans up cache and trash dirs", async () => {
    getCatalogByIdMock.mockResolvedValue({ id: "c2", path: "/media/work" });
    deleteCatalogMock.mockResolvedValue({});
    rmMock.mockResolvedValue(undefined);
    await deleteCatalogWithMode("c2", "detach");
    const rmPaths = rmMock.mock.calls.map((c) => c[0] as string);
    expect(rmPaths.some((p) => p.includes("c2"))).toBe(true);
  });
});
