import { describe, expect, it, vi } from "vitest";
import { JobType } from "@lumio/shared";
import { processNextJob } from "./consumer.js";

function dbWithClaim(row: unknown) {
  return {
    $queryRaw: vi.fn().mockResolvedValue(row ? [row] : []),
    job: { update: vi.fn().mockResolvedValue({}) },
  };
}

describe("processNextJob", () => {
  it("returns 'empty' and runs nothing when the queue is empty", async () => {
    const db = dbWithClaim(null);
    const handler = vi.fn();
    const result = await processNextJob(db as never, { [JobType.rescan]: handler }, {});
    expect(result).toBe("empty");
    expect(handler).not.toHaveBeenCalled();
  });

  it("runs the matching handler and marks the job succeeded", async () => {
    const db = dbWithClaim({ id: "j1", type: "rescan", status: "running" });
    const handler = vi.fn().mockResolvedValue(undefined);
    const onClaim = vi.fn();
    const onSettle = vi.fn();

    const result = await processNextJob(db as never, { [JobType.rescan]: handler }, { onClaim, onSettle });

    expect(result).toBe("ran");
    expect(handler).toHaveBeenCalledOnce();
    expect(onClaim).toHaveBeenCalledWith(expect.objectContaining({ id: "j1" }));
    expect(onSettle).toHaveBeenCalledWith(expect.objectContaining({ id: "j1" }));
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: expect.objectContaining({ status: "succeeded" }),
    });
  });

  it("marks the job failed when the handler throws, and still settles", async () => {
    const db = dbWithClaim({ id: "j2", type: "purge_all", status: "running" });
    const handler = vi.fn().mockRejectedValue(new Error("kaboom"));
    const onSettle = vi.fn();

    const result = await processNextJob(db as never, { [JobType.purge_all]: handler }, { onSettle });

    expect(result).toBe("ran");
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "j2" },
      data: expect.objectContaining({ status: "failed", error: "kaboom" }),
    });
    expect(onSettle).toHaveBeenCalledOnce();
  });

  it("fails the job when there is no handler for its type", async () => {
    const db = dbWithClaim({ id: "j3", type: "rescan", status: "running" });
    const result = await processNextJob(db as never, {}, {});
    expect(result).toBe("ran");
    expect(db.job.update).toHaveBeenCalledWith({
      where: { id: "j3" },
      data: expect.objectContaining({ status: "failed" }),
    });
  });
});
