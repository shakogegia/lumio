import { describe, expect, it, vi, beforeEach } from "vitest";

const requireSessionMock = vi.fn();
vi.mock("./server-session.js", () => ({
  requireSession: () => requireSessionMock(),
}));

const getCatalogBySlugMock = vi.fn();
vi.mock("@lumio/db", () => ({
  getCatalogBySlug: (...args: unknown[]) => getCatalogBySlugMock(...args),
}));

import { withCatalog } from "./with-catalog.js";

const session = { user: { id: "u1", name: "Test User", email: "test@example.com" } };

describe("withCatalog", () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    getCatalogBySlugMock.mockReset();
  });

  it("returns 401 when unauthenticated (session guard fires first)", async () => {
    const response = new Response("no", { status: 401 });
    requireSessionMock.mockResolvedValue({ session: null, response });
    const handler = vi.fn();
    const ctx = { params: Promise.resolve({ catalog: "family" }) };
    const result = await withCatalog(handler)(new Request("http://x/api"), ctx);
    expect(result).toBe(response);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler with (request, context, extras) when slug resolves to a catalog", async () => {
    requireSessionMock.mockResolvedValue({ session, response: null });
    const catalog = {
      id: "cat-1",
      slug: "family",
      name: "Family",
      path: "/media/family",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    getCatalogBySlugMock.mockResolvedValue(catalog);
    const ok = new Response("ok");
    const handler = vi.fn().mockResolvedValue(ok);
    const req = new Request("http://x/api");
    const ctx = { params: Promise.resolve({ catalog: "family" }) };
    const result = await withCatalog(handler)(req, ctx);
    expect(result).toBe(ok);
    expect(getCatalogBySlugMock).toHaveBeenCalledWith("family");
    expect(handler).toHaveBeenCalledWith(req, ctx, { session, catalog });
  });

  it("returns 404 when the catalog slug is not found", async () => {
    requireSessionMock.mockResolvedValue({ session, response: null });
    getCatalogBySlugMock.mockResolvedValue(null);
    const handler = vi.fn();
    const ctx = { params: Promise.resolve({ catalog: "unknown-slug" }) };
    const result = await withCatalog(handler)(new Request("http://x/api"), ctx);
    expect(result.status).toBe(404);
    expect(handler).not.toHaveBeenCalled();
  });
});
