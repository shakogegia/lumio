import { describe, expect, it } from "vitest";
import { runPool } from "./pool.js";

describe("runPool", () => {
  it("runs the task for every index in [0, total)", async () => {
    const seen: number[] = [];
    await runPool(5, 2, async (i) => {
      seen.push(i);
    });
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("never exceeds `limit` tasks in flight at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await runPool(20, 3, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("is a no-op when total is 0", async () => {
    let calls = 0;
    await runPool(0, 4, async () => {
      calls++;
    });
    expect(calls).toBe(0);
  });
});
