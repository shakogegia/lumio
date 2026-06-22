"use client";

import { Fragment, useEffect, useState } from "react";
import { ArrowUp, Check, ChevronRight, Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  breadcrumbSegments,
  fetchBrowse,
  type BrowseResult,
} from "@/lib/fs-browse";

/**
 * A modal that navigates the server filesystem (bounded to `MEDIA_ROOT`) and
 * lets the user pick a folder. Catalog-agnostic — used both in first-run setup
 * and in the catalog manager, so it intentionally does NOT read `useCatalog()`.
 *
 * Backed by `GET /api/fs/browse?path=<abs>` via {@link fetchBrowse}.
 */
export function FolderBrowserDialog({
  open,
  onOpenChange,
  onPick,
  initialPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives the absolute server path of the chosen folder. */
  onPick: (path: string) => void;
  /** Where to start; defaults to `MEDIA_ROOT` (the route's no-path listing). */
  initialPath?: string;
}) {
  // `null` while we haven't navigated yet → the no-path (root) listing.
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The media-root path, learned from the first listing with `parent === null`.
  // Drives the breadcrumb's leading "root" crumb.
  const [rootPath, setRootPath] = useState<string | null>(null);

  // Reset to the requested starting point each time the dialog opens. We read
  // `initialPath` here but intentionally don't list it as a dep — re-seeding
  // should track the dialog opening, not every prop tick.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrentPath(initialPath ?? null);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fetch whenever the open dialog's target path changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    fetchBrowse(currentPath ?? undefined)
      .then((data) => {
        if (cancelled) return;
        setResult(data);
        if (data.parent === null) setRootPath(data.path);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't open that folder.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currentPath]);

  const path = result?.path ?? "";
  // Until we know the media root, fall back to the current listing's path so the
  // breadcrumb still renders sensibly.
  const root = rootPath ?? path;
  const rootLabel = root ? (root.split("/").filter(Boolean).pop() ?? "Media") : "Media";
  const crumbs = path ? breadcrumbSegments(path, root, rootLabel) : [];

  function navigateTo(next: string) {
    setCurrentPath(next);
  }

  function handlePick() {
    if (!path) return;
    onPick(path);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Choose a folder</DialogTitle>
        </DialogHeader>

        {/* Breadcrumb + Up */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!result || result.parent === null}
            onClick={() => result?.parent && navigateTo(result.parent)}
            aria-label="Up one folder"
          >
            <ArrowUp />
          </Button>
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm"
          >
            {crumbs.map((crumb, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <Fragment key={crumb.path}>
                  {i > 0 && (
                    <ChevronRight
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => navigateTo(crumb.path)}
                    disabled={isLast}
                    className={cn(
                      "shrink-0 truncate rounded px-1.5 py-0.5",
                      isLast
                        ? "font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {crumb.name}
                  </button>
                </Fragment>
              );
            })}
          </nav>
        </div>

        {/* Directory list */}
        <div className="h-64 overflow-y-auto rounded-md border border-border p-1">
          {loading ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="px-2 py-1.5 text-sm text-destructive">{error}</p>
          ) : result && result.dirs.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No subfolders here.
            </p>
          ) : (
            result?.dirs.map((dir) => (
              <button
                key={dir.path}
                type="button"
                onClick={() => navigateTo(dir.path)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              >
                <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{dir.name}</span>
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handlePick} disabled={!path || loading}>
            <Check />
            Use this folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
