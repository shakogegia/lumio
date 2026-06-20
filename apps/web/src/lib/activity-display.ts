import { type ActivitySnapshot, type JobDTO, JobType } from "@lumio/shared";

/** The job the indicator should foreground (the first active one), if any. */
function activeJob(snapshot: ActivitySnapshot): JobDTO | undefined {
  return snapshot.jobs[0];
}

/** Busy = a job is running/queued, or the watcher is importing new files. */
export function isBusy(snapshot: ActivitySnapshot): boolean {
  if (snapshot.jobs.length > 0) return true;
  return snapshot.worker.activity.startsWith("importing");
}

const JOB_VERB: Record<JobType, string> = {
  [JobType.rescan]: "Rescanning",
  [JobType.purge_all]: "Deleting all photos…",
  [JobType.empty_trash]: "Emptying trash…",
};

/** Human label for the sidebar tooltip / aria-label. */
export function activityLabel(snapshot: ActivitySnapshot): string {
  const job = activeJob(snapshot);
  if (job) {
    if (job.type === JobType.rescan) {
      return job.total != null
        ? `Rescanning ${job.processed.toLocaleString("en-US")}/${job.total.toLocaleString("en-US")}`
        : "Rescanning…";
    }
    return JOB_VERB[job.type];
  }
  const importing = snapshot.worker.activity.match(/^importing (\d+)$/);
  if (importing) return `Importing ${importing[1]} photos`;
  return snapshot.worker.online ? "Worker online" : "Worker offline";
}
