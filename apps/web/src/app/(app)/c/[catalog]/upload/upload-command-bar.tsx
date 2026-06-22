"use client";

import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { RowSummary } from "@/lib/upload-rows";

/**
 * Batch status callout. While files are in flight it shows a progress bar; once
 * the batch settles it shows outcome counts plus Retry-failed / View-library.
 * Stays mounted in select mode (it's batch info, not selection chrome).
 */
export function UploadCommandBar({
  summary,
  unsupportedCount,
  onRetryFailed,
}: {
  summary: RowSummary;
  unsupportedCount: number;
  onRetryFailed: () => void;
}) {
  const uploading = summary.uploading > 0;
  const hasFailures = summary.error > 0;
  const pct = summary.total === 0 ? 0 : Math.round((summary.done / summary.total) * 100);

  return (
    <Alert>
      {uploading ? (
        <Loader2 className="animate-spin" aria-hidden />
      ) : hasFailures ? (
        <TriangleAlert className="text-destructive" aria-hidden />
      ) : (
        <CheckCircle2 className="text-green-600 dark:text-green-500" aria-hidden />
      )}

      <AlertTitle>
        {uploading ? `Uploading ${summary.done} of ${summary.total}…` : "Upload complete"}
      </AlertTitle>

      <AlertDescription>
        {uploading ? (
          <Progress value={pct} className="mt-1 w-full" />
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Count dot="bg-green-600 dark:bg-green-500" label={`${summary.added} added`} />
              {summary.duplicate > 0 ? (
                <Count
                  dot="bg-amber-500"
                  label={`${summary.duplicate} ${summary.duplicate === 1 ? "duplicate" : "duplicates"}`}
                />
              ) : null}
              {hasFailures ? <Count dot="bg-destructive" label={`${summary.error} failed`} /> : null}
              {unsupportedCount > 0 ? (
                <Count dot="bg-muted-foreground" label={`${unsupportedCount} unsupported`} />
              ) : null}
            </div>
            {hasFailures ? (
              <Button variant="outline" size="sm" className="mt-2" onClick={onRetryFailed}>
                Retry failed
              </Button>
            ) : null}
          </>
        )}
      </AlertDescription>
    </Alert>
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
