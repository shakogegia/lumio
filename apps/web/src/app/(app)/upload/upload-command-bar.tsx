"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { RowSummary } from "@/lib/upload-rows";

/**
 * Batch status bar. While files are in flight it shows a progress bar; once the
 * batch settles it shows outcome counts plus Retry-failed / View-library. Stays
 * mounted in select mode (it's batch info, not selection chrome).
 */
export function UploadCommandBar({
  summary,
  unsupportedCount,
  onRetryFailed,
  onViewLibrary,
}: {
  summary: RowSummary;
  unsupportedCount: number;
  onRetryFailed: () => void;
  onViewLibrary: () => void;
}) {
  const uploading = summary.uploading > 0;
  const pct = summary.total === 0 ? 0 : Math.round((summary.done / summary.total) * 100);

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {uploading ? `Uploading ${summary.done} of ${summary.total}…` : "Upload complete"}
          </p>
          {!uploading ? (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <Count dot="bg-green-600 dark:bg-green-500" label={`${summary.added} added`} />
              {summary.duplicate > 0 ? (
                <Count
                  dot="bg-amber-500"
                  label={`${summary.duplicate} ${summary.duplicate === 1 ? "duplicate" : "duplicates"}`}
                />
              ) : null}
              {summary.error > 0 ? <Count dot="bg-destructive" label={`${summary.error} failed`} /> : null}
              {unsupportedCount > 0 ? (
                <Count dot="bg-muted-foreground" label={`${unsupportedCount} unsupported`} />
              ) : null}
            </div>
          ) : null}
        </div>

        {!uploading ? (
          <div className="flex items-center gap-2">
            {summary.error > 0 ? (
              <Button variant="outline" size="sm" onClick={onRetryFailed}>
                Retry failed
              </Button>
            ) : null}
            <Button size="sm" onClick={onViewLibrary}>
              View library
            </Button>
          </div>
        ) : null}
      </div>

      {uploading ? <Progress value={pct} className="mt-3" /> : null}
    </div>
  );
}

function Count({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}
