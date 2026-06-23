import { describe, expect, it } from "vitest";
import { z } from "zod";
import { binaryResponse, errorJson, mapServiceError, parseJson, parseQuery } from "./route-helpers.js";
import { AlbumNotFoundError, SmartAlbumMutationError } from "./albums-service.js";
import { FolderNotFoundError } from "./folders-service.js";

const bodyReq = (raw: string) =>
  new Request("http://x/api", { method: "POST", body: raw, headers: { "content-type": "application/json" } });

describe("errorJson", () => {
  it("emits { error } with the status, and includes details when given", async () => {
    const r = errorJson("nope", 404);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual({ error: "nope" });
    const r2 = errorJson("bad", 400, { a: 1 });
    expect(await r2.json()).toEqual({ error: "bad", details: { a: 1 } });
  });
});

describe("parseJson", () => {
  const schema = z.object({ name: z.string() });

  it("returns data on a valid body", async () => {
    const r = await parseJson(bodyReq(JSON.stringify({ name: "x" })), schema);
    expect("data" in r && r.data).toEqual({ name: "x" });
  });

  it("returns a 400 response (not throw) on malformed JSON", async () => {
    const r = await parseJson(bodyReq("{not json"), schema);
    expect("response" in r).toBe(true);
    if ("response" in r) expect(r.response.status).toBe(400);
  });

  it("returns a 400 response on schema mismatch", async () => {
    const r = await parseJson(bodyReq(JSON.stringify({ name: 1 })), schema);
    expect("response" in r && r.response.status).toBe(400);
  });
});

describe("parseQuery", () => {
  const schema = z.object({ q: z.string() });
  it("parses searchParams; 400 on mismatch", () => {
    const ok = parseQuery(new Request("http://x/api?q=hi"), schema);
    expect("data" in ok && ok.data).toEqual({ q: "hi" });
    const bad = parseQuery(new Request("http://x/api"), schema);
    expect("response" in bad && bad.response.status).toBe(400);
  });
});

describe("mapServiceError", () => {
  it("maps known typed errors to status codes, returns null for unknown", () => {
    expect(mapServiceError(new AlbumNotFoundError("x"))?.status).toBe(404);
    expect(mapServiceError(new FolderNotFoundError("x"))?.status).toBe(404);
    expect(mapServiceError(new SmartAlbumMutationError("x"))?.status).toBe(400);
    expect(mapServiceError(new Error("generic"))).toBeNull();
  });
});

describe("binaryResponse", () => {
  it("sets content-type, immutable cache, and optional attachment disposition", () => {
    const r = binaryResponse(Buffer.from("x"), { contentType: "image/webp" });
    expect(r.headers.get("Content-Type")).toBe("image/webp");
    expect(r.headers.get("Cache-Control")).toContain("immutable");
    const d = binaryResponse(Buffer.from("x"), { contentType: "image/jpeg", downloadAs: "p.jpg" });
    expect(d.headers.get("Content-Disposition")).toBe('attachment; filename="p.jpg"');
  });
});
