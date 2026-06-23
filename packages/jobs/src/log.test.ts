import { describe, expect, it, vi } from "vitest";
import { LogLevel } from "@lumio/shared";
import { createWorkerLogger, getWorkerLogs, trimWorkerLogs } from "./log.js";

const silent = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

function fakeDb() {
  return {
    workerLog: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("createWorkerLogger", () => {
  it("buffers entries and writes nothing until the flush threshold", async () => {
    const db = fakeDb();
    const logger = createWorkerLogger(db as never, { flushThreshold: 3, console: silent, now: () => 1000 });
    logger.info("a");
    logger.warn("b");
    expect(db.workerLog.createMany).not.toHaveBeenCalled();
    logger.error("c"); // 3rd entry hits threshold → auto-flush
    await logger.flush();
    expect(db.workerLog.createMany).toHaveBeenCalledTimes(1);
    expect(db.workerLog.createMany.mock.calls[0]![0].data).toHaveLength(3);
    await logger.close();
  });

  it("flush() persists buffered rows with meta + the buffered timestamp", async () => {
    const db = fakeDb();
    const logger = createWorkerLogger(db as never, { flushThreshold: 100, console: silent, now: () => 5000 });
    logger.warn("skip x", { scope: "scan", catalogId: "c1" });
    await logger.flush();
    expect(db.workerLog.createMany).toHaveBeenCalledWith({
      data: [
        { level: LogLevel.Warn, scope: "scan", message: "skip x", catalogId: "c1", jobId: null, createdAt: new Date(5000) },
      ],
    });
    await logger.close();
  });

  it("close() performs a final flush of pending rows", async () => {
    const db = fakeDb();
    const logger = createWorkerLogger(db as never, { flushThreshold: 100, console: silent, now: () => 1 });
    logger.info("pending");
    await logger.close();
    expect(db.workerLog.createMany).toHaveBeenCalledTimes(1);
  });

  it("tees each level to the matching console method", async () => {
    const out = { log: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const db = fakeDb();
    const logger = createWorkerLogger(db as never, { console: out, now: () => 1 });
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.debug("d");
    expect(out.log).toHaveBeenCalledWith("i");
    expect(out.warn).toHaveBeenCalledWith("w");
    expect(out.error).toHaveBeenCalledWith("e");
    expect(out.debug).toHaveBeenCalledWith("d");
    await logger.close();
  });
});

describe("trimWorkerLogs", () => {
  it("deletes rows older than maxAgeMs and beyond the maxRows cap", async () => {
    const db = fakeDb();
    db.workerLog.findFirst.mockResolvedValue({ createdAt: new Date(2000) });
    await trimWorkerLogs(db as never, { now: () => 10_000, maxRows: 100, maxAgeMs: 5000 });
    expect(db.workerLog.deleteMany).toHaveBeenNthCalledWith(1, { where: { createdAt: { lt: new Date(5000) } } });
    expect(db.workerLog.findFirst).toHaveBeenCalledWith({ orderBy: { createdAt: "desc" }, skip: 100, select: { createdAt: true } });
    expect(db.workerLog.deleteMany).toHaveBeenNthCalledWith(2, { where: { createdAt: { lt: new Date(2000) } } });
  });

  it("skips the count-cap delete when under the cap", async () => {
    const db = fakeDb();
    db.workerLog.findFirst.mockResolvedValue(null);
    await trimWorkerLogs(db as never, { now: () => 10_000, maxRows: 100, maxAgeMs: 5000 });
    expect(db.workerLog.deleteMany).toHaveBeenCalledTimes(1);
  });
});

describe("getWorkerLogs", () => {
  it("filters by level + before, orders newest-first, and maps createdAt to ISO", async () => {
    const db = fakeDb();
    const before = new Date("2026-06-23T12:00:00.000Z");
    db.workerLog.findMany.mockResolvedValue([
      { id: "1", level: "error", scope: "scan", message: "boom", catalogId: "c1", jobId: null, createdAt: new Date("2026-06-23T10:00:00.000Z") },
    ]);
    const out = await getWorkerLogs(db as never, { levels: [LogLevel.Error], before, limit: 50 });
    expect(db.workerLog.findMany).toHaveBeenCalledWith({
      where: { level: { in: [LogLevel.Error] }, createdAt: { lt: before } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    expect(out).toEqual([
      { id: "1", level: LogLevel.Error, scope: "scan", message: "boom", catalogId: "c1", jobId: null, createdAt: "2026-06-23T10:00:00.000Z" },
    ]);
  });

  it("omits the level + range filters when none are given", async () => {
    const db = fakeDb();
    await getWorkerLogs(db as never, { levels: [], limit: 10 });
    expect(db.workerLog.findMany).toHaveBeenCalledWith({ where: {}, orderBy: { createdAt: "desc" }, take: 10 });
  });
});
