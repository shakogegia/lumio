import type { ActivityState } from "@lumio/jobs";

/**
 * Mutable in-process activity, shared between the watcher (which bumps
 * `importing` while ingesting new files) and the heartbeat loop (which reads it).
 * The job consumer sets `currentJob` on claim and clears it on settle.
 */
export const activity: ActivityState = { importing: 0, currentJob: null };
