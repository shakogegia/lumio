import { describe, expect, it } from "vitest";
import { LogLevel, LOGS_PAGE_SIZE, logsQuerySchema } from "./logs.js";

describe("logsQuerySchema", () => {
  it("parses comma-separated levels, before, since, and limit", () => {
    const r = logsQuerySchema.parse({
      level: "error,warn",
      before: "2026-06-23T12:00:00.000Z",
      since: "2026-06-23T00:00:00.000Z",
      limit: "100",
    });
    expect(r.level).toEqual([LogLevel.Error, LogLevel.Warn]);
    expect(r.before).toBe("2026-06-23T12:00:00.000Z");
    expect(r.since).toBe("2026-06-23T00:00:00.000Z");
    expect(r.limit).toBe(100);
  });

  it("defaults level to [] and limit to the page size, dropping unknown levels", () => {
    const r = logsQuerySchema.parse({ level: "error,bogus" });
    expect(r.level).toEqual([LogLevel.Error]);
    expect(r.before).toBeUndefined();
    expect(r.limit).toBe(LOGS_PAGE_SIZE);
  });

  it("rejects a too-large limit", () => {
    expect(() => logsQuerySchema.parse({ limit: "99999" })).toThrow();
  });
});
