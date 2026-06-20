import { describe, expect, it, vi } from "vitest";
import { JobType } from "@lumio/shared";
import { buildHandlers } from "./handlers.js";

describe("buildHandlers", () => {
  it("rescan forwards scan progress to the reporter", async () => {
    const scan = vi.fn(async (onProgress?: (d: number, t: number) => void) => {
      onProgress?.(1, 2);
      onProgress?.(2, 2);
    });
    const handlers = buildHandlers({
      scan,
      purgeAll: vi.fn(),
      emptyTrash: vi.fn(),
    });
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.rescan](report);

    expect(scan).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(1, 2, "Scanning…");
    expect(report).toHaveBeenCalledWith(2, 2, "Scanning…");
  });

  it("purge_all runs the purge and reports the final count", async () => {
    const purgeAll = vi.fn().mockResolvedValue({ deleted: 7 });
    const handlers = buildHandlers({ scan: vi.fn(), purgeAll, emptyTrash: vi.fn() });
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.purge_all](report);

    expect(purgeAll).toHaveBeenCalledOnce();
    expect(report).toHaveBeenLastCalledWith(7, 7, null);
  });

  it("empty_trash runs the purge and reports the final count", async () => {
    const emptyTrash = vi.fn().mockResolvedValue({ deleted: 3 });
    const handlers = buildHandlers({ scan: vi.fn(), purgeAll: vi.fn(), emptyTrash });
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.empty_trash](report);

    expect(emptyTrash).toHaveBeenCalledOnce();
    expect(report).toHaveBeenLastCalledWith(3, 3, null);
  });
});
