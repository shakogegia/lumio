import { describe, expect, it, vi } from "vitest";
import { JobType } from "@lumio/shared";
import { buildHandlers } from "./handlers.js";

describe("buildHandlers", () => {
  it("rescan forwards scan progress to the reporter", async () => {
    const scan = vi.fn(async (onProgress?: (d: number, t: number) => void) => {
      onProgress?.(1, 2);
      onProgress?.(2, 2);
    });
    const handlers = buildHandlers(() => ({
      scan,
      purgeAll: vi.fn(),
      emptyTrash: vi.fn(),
      processTrash: vi.fn(),
      reorganize: vi.fn(),
    }));
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.rescan](report, { catalogId: "cat1" } as never);

    expect(scan).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(1, 2, "Scanning…");
    expect(report).toHaveBeenCalledWith(2, 2, "Scanning…");
  });

  it("purge_all runs the purge and reports the final count", async () => {
    const purgeAll = vi.fn().mockResolvedValue({ deleted: 7 });
    const handlers = buildHandlers(() => ({ scan: vi.fn(), purgeAll, emptyTrash: vi.fn(), processTrash: vi.fn(), reorganize: vi.fn() }));
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.purge_all](report, { catalogId: "cat1" } as never);

    expect(purgeAll).toHaveBeenCalledOnce();
    expect(report).toHaveBeenLastCalledWith(7, 7, null);
  });

  it("empty_trash runs the purge and reports the final count", async () => {
    const emptyTrash = vi.fn().mockResolvedValue({ deleted: 3 });
    const handlers = buildHandlers(() => ({ scan: vi.fn(), purgeAll: vi.fn(), emptyTrash, processTrash: vi.fn(), reorganize: vi.fn() }));
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.empty_trash](report, { catalogId: "cat1" } as never);

    expect(emptyTrash).toHaveBeenCalledOnce();
    expect(report).toHaveBeenLastCalledWith(3, 3, null);
  });

  it("process_trash runs finalizeTrash and reports the final count", async () => {
    const processTrash = vi.fn().mockResolvedValue({ finalized: 5 });
    const handlers = buildHandlers(() => ({ scan: vi.fn(), purgeAll: vi.fn(), emptyTrash: vi.fn(), processTrash, reorganize: vi.fn() }));
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.process_trash](report, { catalogId: "cat1" } as never);

    expect(processTrash).toHaveBeenCalledOnce();
    expect(report).toHaveBeenLastCalledWith(5, 5, null);
  });

  it("rescan is a no-op when catalogId is null", async () => {
    const scan = vi.fn();
    const handlers = buildHandlers(() => ({ scan, purgeAll: vi.fn(), emptyTrash: vi.fn(), processTrash: vi.fn(), reorganize: vi.fn() }));
    const report = vi.fn();

    await handlers[JobType.rescan](report, { catalogId: null } as never);

    expect(scan).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("purge_all is a no-op when catalogId is null", async () => {
    const purgeAll = vi.fn();
    const handlers = buildHandlers(() => ({ scan: vi.fn(), purgeAll, emptyTrash: vi.fn(), processTrash: vi.fn(), reorganize: vi.fn() }));
    const report = vi.fn();

    await handlers[JobType.purge_all](report, { catalogId: null } as never);

    expect(purgeAll).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("empty_trash is a no-op when catalogId is null", async () => {
    const emptyTrash = vi.fn();
    const handlers = buildHandlers(() => ({ scan: vi.fn(), purgeAll: vi.fn(), emptyTrash, processTrash: vi.fn(), reorganize: vi.fn() }));
    const report = vi.fn();

    await handlers[JobType.empty_trash](report, { catalogId: null } as never);

    expect(emptyTrash).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("process_trash is a no-op when catalogId is null", async () => {
    const processTrash = vi.fn();
    const handlers = buildHandlers(() => ({ scan: vi.fn(), purgeAll: vi.fn(), emptyTrash: vi.fn(), processTrash, reorganize: vi.fn() }));
    const report = vi.fn();

    await handlers[JobType.process_trash](report, { catalogId: null } as never);

    expect(processTrash).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });

  it("reorganize runs the mover (uploads only) and reports the moved count", async () => {
    const reorganize = vi.fn().mockResolvedValue({ moved: 4, skipped: 1, failed: 0 });
    const handlers = buildHandlers(() => ({
      scan: vi.fn(), purgeAll: vi.fn(), emptyTrash: vi.fn(), processTrash: vi.fn(), reorganize,
    }));
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.reorganize](report, { catalogId: "cat1" } as never);

    expect(reorganize).toHaveBeenCalledWith(false, expect.any(Function));
    expect(report).toHaveBeenLastCalledWith(4, 4, null);
  });

  it("reorganize_all runs the mover with includeFilesystem=true", async () => {
    const reorganize = vi.fn().mockResolvedValue({ moved: 2, skipped: 0, failed: 0 });
    const handlers = buildHandlers(() => ({
      scan: vi.fn(), purgeAll: vi.fn(), emptyTrash: vi.fn(), processTrash: vi.fn(), reorganize,
    }));
    const report = vi.fn().mockResolvedValue(undefined);

    await handlers[JobType.reorganize_all](report, { catalogId: "cat1" } as never);

    expect(reorganize).toHaveBeenCalledWith(true, expect.any(Function));
    expect(report).toHaveBeenLastCalledWith(2, 2, null);
  });

  it("reorganize is a no-op when catalogId is null", async () => {
    const reorganize = vi.fn();
    const handlers = buildHandlers(() => ({
      scan: vi.fn(), purgeAll: vi.fn(), emptyTrash: vi.fn(), processTrash: vi.fn(), reorganize,
    }));
    const report = vi.fn();

    await handlers[JobType.reorganize](report, { catalogId: null } as never);

    expect(reorganize).not.toHaveBeenCalled();
    expect(report).not.toHaveBeenCalled();
  });
});
