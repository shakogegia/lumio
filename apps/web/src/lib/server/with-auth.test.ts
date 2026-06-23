import { describe, expect, it, vi, beforeEach } from "vitest";

const requireSessionMock = vi.fn();
vi.mock("./server-session.js", () => ({
  requireSession: () => requireSessionMock(),
}));

import { withAuth } from "./with-auth.js";

describe("withAuth", () => {
  beforeEach(() => requireSessionMock.mockReset());

  it("returns the 401 response and does NOT call the handler when unauthenticated", async () => {
    const response = new Response("no", { status: 401 });
    requireSessionMock.mockResolvedValue({ session: null, response });
    const handler = vi.fn();
    const result = await withAuth(handler)(new Request("http://x/api"), {});
    expect(result).toBe(response);
    expect(handler).not.toHaveBeenCalled();
  });

  it("calls the handler with (request, context, session) when authenticated", async () => {
    const session = { user: { id: "u1" } };
    requireSessionMock.mockResolvedValue({ session, response: null });
    const ok = new Response("ok");
    const handler = vi.fn().mockResolvedValue(ok);
    const req = new Request("http://x/api");
    const ctx = { params: Promise.resolve({ id: "p1" }) };
    const result = await withAuth(handler)(req, ctx);
    expect(result).toBe(ok);
    expect(handler).toHaveBeenCalledWith(req, ctx, session);
  });
});
