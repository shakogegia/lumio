import { describe, expect, it, vi } from "vitest";
import { JobType } from "@lumio/shared";
import {
  claimNextJob,
  enqueueJob,
  findActiveJob,
  getActiveJobs,
  markJobFailed,
  markJobSucceeded,
  recoverOrphanedJobs,
} from "./queue.js";

function fakeDb(overrides: Record<string, unknown> = {}) {
  return {
    job: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "new", type: "rescan", status: "queued" }),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      ...overrides,
    },
  };
}

describe("enqueueJob", () => {
  it("creates a new job when none is active", async () => {
    const db = fakeDb();
    const job = await enqueueJob(db as never, JobType.rescan);
    expect(db.job.create).toHaveBeenCalledWith({ data: { type: "rescan" } });
    expect(job.id).toBe("new");
  });

  it("returns the existing active job instead of double-queueing", async () => {
    const existing = { id: "x", type: "rescan", status: "running" };
    const db = fakeDb({ findFirst: vi.fn().mockResolvedValue(existing) });
    const job = await enqueueJob(db as never, JobType.rescan);
    expect(job).toBe(existing);
    expect(db.job.create).not.toHaveBeenCalled();
  });
});

describe("findActiveJob", () => {
  it("queries for queued/running of the given type", async () => {
    const db = fakeDb();
    await findActiveJob(db as never, JobType.purge_all);
    expect(db.job.findFirst).toHaveBeenCalledWith({
      where: { type: "purge_all", status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("getActiveJobs", () => {
  it("lists all queued/running jobs oldest-first", async () => {
    const db = fakeDb();
    await getActiveJobs(db as never);
    expect(db.job.findMany).toHaveBeenCalledWith({
      where: { status: { in: ["queued", "running"] } },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("recoverOrphanedJobs", () => {
  it("requeues any job left running (single-worker: must be orphaned)", async () => {
    const db = fakeDb({ updateMany: vi.fn().mockResolvedValue({ count: 2 }) });
    const n = await recoverOrphanedJobs(db as never);
    expect(db.job.updateMany).toHaveBeenCalledWith({
      where: { status: "running" },
      data: { status: "queued", startedAt: null },
    });
    expect(n).toBe(2);
  });
});

describe("markJobSucceeded / markJobFailed", () => {
  it("marks succeeded", async () => {
    const db = fakeDb();
    await markJobSucceeded(db as never, "j1");
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: expect.objectContaining({ status: "succeeded", finishedAt: expect.any(Date) }),
    });
  });

  it("marks failed with the error message", async () => {
    const db = fakeDb();
    await markJobFailed(db as never, "j1", "boom");
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: expect.objectContaining({ status: "failed", error: "boom", finishedAt: expect.any(Date) }),
    });
  });
});

describe("claimNextJob", () => {
  it("returns the claimed row when one was queued", async () => {
    const row = { id: "j1", type: "rescan", status: "running" };
    const db = { $queryRaw: vi.fn().mockResolvedValue([row]) };
    const job = await claimNextJob(db as never);
    expect(job).toBe(row);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it("returns null when nothing was queued", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([]) };
    expect(await claimNextJob(db as never)).toBeNull();
  });
});
