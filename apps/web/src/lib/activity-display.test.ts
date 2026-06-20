import { describe, expect, it } from "vitest";
import { type ActivitySnapshot, JobStatus, JobType } from "@lumio/shared";
import { activityLabel, isBusy } from "./activity-display.js";

const snap = (over: Partial<ActivitySnapshot>): ActivitySnapshot => ({
  worker: { online: true, activity: "watching" },
  jobs: [],
  ...over,
});

describe("isBusy", () => {
  it("is busy when a job is active", () => {
    expect(isBusy(snap({ jobs: [{ id: "j", type: JobType.rescan, status: JobStatus.running, total: 10, processed: 3, message: null, error: null }] }))).toBe(true);
  });
  it("is busy when the watcher is importing", () => {
    expect(isBusy(snap({ worker: { online: true, activity: "importing 5" } }))).toBe(true);
  });
  it("is idle when watching with no jobs", () => {
    expect(isBusy(snap({}))).toBe(false);
  });
});

describe("activityLabel", () => {
  it("shows job progress with a count when total is known", () => {
    expect(
      activityLabel(snap({ jobs: [{ id: "j", type: JobType.rescan, status: JobStatus.running, total: 1200, processed: 340, message: null, error: null }] })),
    ).toBe("Rescanning 340/1,200");
  });
  it("labels purge + empty jobs", () => {
    expect(activityLabel(snap({ jobs: [{ id: "j", type: JobType.purge_all, status: JobStatus.running, total: null, processed: 0, message: null, error: null }] }))).toBe("Deleting all photos…");
    expect(activityLabel(snap({ jobs: [{ id: "j", type: JobType.empty_trash, status: JobStatus.running, total: null, processed: 0, message: null, error: null }] }))).toBe("Emptying trash…");
  });
  it("falls back to the worker activity when no job is active", () => {
    expect(activityLabel(snap({ worker: { online: true, activity: "importing 5" } }))).toBe("Importing 5 photos");
    expect(activityLabel(snap({}))).toBe("Worker online");
    expect(activityLabel(snap({ worker: { online: false, activity: "offline" } }))).toBe("Worker offline");
  });
});
