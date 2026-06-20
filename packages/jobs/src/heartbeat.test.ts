import { describe, expect, it, vi } from "vitest";
import { readWorkerStatus, writeHeartbeat } from "./heartbeat.js";

describe("writeHeartbeat", () => {
  it("upserts the singleton row with activity + jobId + timestamp", async () => {
    const db = { workerStatus: { upsert: vi.fn().mockResolvedValue({}) } };
    const now = new Date("2026-06-20T12:00:00.000Z");
    await writeHeartbeat(db as never, "watching", "j1", now);
    expect(db.workerStatus.upsert).toHaveBeenCalledWith({
      where: { id: "singleton" },
      create: { id: "singleton", lastSeenAt: now, activity: "watching", jobId: "j1" },
      update: { lastSeenAt: now, activity: "watching", jobId: "j1" },
    });
  });
});

describe("readWorkerStatus", () => {
  it("reads the singleton row", async () => {
    const db = { workerStatus: { findUnique: vi.fn().mockResolvedValue(null) } };
    await readWorkerStatus(db as never);
    expect(db.workerStatus.findUnique).toHaveBeenCalledWith({ where: { id: "singleton" } });
  });
});
