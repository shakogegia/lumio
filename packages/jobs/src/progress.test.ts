import { describe, expect, it, vi } from "vitest";
import { createProgressReporter } from "./progress.js";

describe("createProgressReporter", () => {
  it("writes the first update and throttles writes within the interval", async () => {
    const db = { job: { update: vi.fn().mockResolvedValue({}) } };
    let clock = 1000;
    const report = createProgressReporter(db as never, "j1", {
      minIntervalMs: 250,
      now: () => clock,
    });

    await report(1, 10, "Scanning…"); // first → writes
    clock = 1100;
    await report(2, 10, null); // +100ms → throttled
    clock = 1300;
    await report(3, 10, null); // +300ms from last write → writes

    expect(db.job.update).toHaveBeenCalledTimes(2);
    expect(db.job.update).toHaveBeenNthCalledWith(1, {
      where: { id: "j1" },
      data: { processed: 1, total: 10, message: "Scanning…" },
    });
    expect(db.job.update).toHaveBeenNthCalledWith(2, {
      where: { id: "j1" },
      data: { processed: 3, total: 10, message: null },
    });
  });
});
