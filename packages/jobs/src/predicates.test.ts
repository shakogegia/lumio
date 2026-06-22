import { describe, expect, it } from "vitest";
import {
  buildActivitySnapshot,
  formatActivity,
  isWorkerOnline,
  shouldWrite,
  toJobDTO,
} from "./predicates.js";

const NOW = new Date("2026-06-20T12:00:00.000Z");

describe("isWorkerOnline", () => {
  it("is online when lastSeenAt is within the stale window", () => {
    expect(isWorkerOnline(new Date(NOW.getTime() - 3000), NOW, 6000)).toBe(true);
  });
  it("is offline when lastSeenAt is older than the window", () => {
    expect(isWorkerOnline(new Date(NOW.getTime() - 9000), NOW, 6000)).toBe(false);
  });
  it("is offline when never seen", () => {
    expect(isWorkerOnline(null, NOW, 6000)).toBe(false);
  });
});

describe("formatActivity", () => {
  it("prefers the current job", () => {
    expect(formatActivity({ importing: 4, currentJob: { id: "j", type: "rescan" } })).toBe(
      "running: rescan",
    );
  });
  it("reports importing when the watcher is busy", () => {
    expect(formatActivity({ importing: 12, currentJob: null })).toBe("importing 12");
  });
  it("is watching when idle", () => {
    expect(formatActivity({ importing: 0, currentJob: null })).toBe("watching");
  });
});

describe("shouldWrite", () => {
  it("always writes the first time", () => {
    expect(shouldWrite(null, 1000, 250)).toBe(true);
  });
  it("skips within the interval", () => {
    expect(shouldWrite(1000, 1100, 250)).toBe(false);
  });
  it("writes once the interval elapses", () => {
    expect(shouldWrite(1000, 1300, 250)).toBe(true);
  });
});

describe("toJobDTO + buildActivitySnapshot", () => {
  const job = {
    id: "j1",
    type: "rescan",
    status: "running",
    total: 100,
    processed: 40,
    message: "Scanning…",
    error: null,
    catalogId: null,
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: null,
  };

  it("strips dates down to the wire DTO", () => {
    expect(toJobDTO(job)).toEqual({
      id: "j1",
      type: "rescan",
      status: "running",
      total: 100,
      processed: 40,
      message: "Scanning…",
      error: null,
    });
  });

  it("combines worker status + jobs into the snapshot", () => {
    const snap = buildActivitySnapshot(
      { id: "singleton", lastSeenAt: new Date(NOW.getTime() - 1000), activity: "running: rescan", jobId: "j1" },
      [job],
      NOW,
      6000,
    );
    expect(snap.worker).toEqual({ online: true, activity: "running: rescan" });
    expect(snap.jobs).toHaveLength(1);
    expect(snap.jobs[0]?.id).toBe("j1");
  });

  it("reports offline + idle when there is no worker status row", () => {
    const snap = buildActivitySnapshot(null, [], NOW, 6000);
    expect(snap.worker).toEqual({ online: false, activity: "offline" });
    expect(snap.jobs).toEqual([]);
  });
});
