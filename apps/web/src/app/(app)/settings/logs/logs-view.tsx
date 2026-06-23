"use client";

import { Bug, CircleAlert, Info, type LucideIcon, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { LOG_LEVELS, LogLevel } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { useLogs, type SinceFilter } from "@/lib/hooks/use-logs";

const LEVEL_LABEL: Record<LogLevel, string> = {
  [LogLevel.Error]: "Error",
  [LogLevel.Warn]: "Warn",
  [LogLevel.Info]: "Info",
  [LogLevel.Debug]: "Debug",
};

const LEVEL_ICON: Record<LogLevel, LucideIcon> = {
  [LogLevel.Error]: CircleAlert,
  [LogLevel.Warn]: TriangleAlert,
  [LogLevel.Info]: Info,
  [LogLevel.Debug]: Bug,
};

const LEVEL_TEXT: Record<LogLevel, string> = {
  [LogLevel.Error]: "text-red-500",
  [LogLevel.Warn]: "text-amber-500",
  [LogLevel.Info]: "text-foreground",
  [LogLevel.Debug]: "text-muted-foreground",
};

const SINCE_OPTIONS: { value: SinceFilter; label: string }[] = [
  { value: "1h", label: "Last hour" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
];

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function LogsView() {
  const [active, setActive] = useState<Set<LogLevel>>(() => new Set(LOG_LEVELS));
  const [since, setSince] = useState<SinceFilter>("24h");

  // Derive a stable, sorted level list from the toggle set so the URL key (and
  // thus the poll effect) doesn't churn on selection order.
  const levels = useMemo(() => LOG_LEVELS.filter((l) => active.has(l)), [active]);
  const { entries, loading, hasMore, loadMore } = useLogs(levels, since);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="multiple"
          variant="outline"
          size="sm"
          value={levels}
          onValueChange={(vals) => setActive(new Set(vals as LogLevel[]))}
        >
          {LOG_LEVELS.map((level) => {
            const Icon = LEVEL_ICON[level];
            return (
              <ToggleGroupItem key={level} value={level} aria-label={LEVEL_LABEL[level]}>
                <Icon className={cn("size-3.5", LEVEL_TEXT[level])} aria-hidden />
                {LEVEL_LABEL[level]}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>

        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={since}
          onValueChange={(val) => {
            if (val) setSince(val as SinceFilter);
          }}
          className="ml-auto"
        >
          {SINCE_OPTIONS.map((opt) => (
            <ToggleGroupItem key={opt.value} value={opt.value}>
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {/* Log stream */}
      <ScrollArea className="h-[calc(100dvh-260px)] rounded-lg border bg-card">
        <div className="p-2 font-mono text-xs">
          {entries.length === 0 && !loading && (
            <p className="px-2 py-8 text-center text-muted-foreground">No logs match these filters.</p>
          )}
          {entries.map((entry) => (
            <div key={entry.id} className="flex gap-3 rounded px-2 py-1 hover:bg-muted/50">
              <time
                className="shrink-0 tabular-nums text-muted-foreground"
                title={new Date(entry.createdAt).toLocaleString()}
              >
                {formatTime(entry.createdAt)}
              </time>
              <span className={cn("w-12 shrink-0 font-semibold uppercase", LEVEL_TEXT[entry.level])}>
                {entry.level}
              </span>
              {entry.scope && <span className="shrink-0 text-muted-foreground">[{entry.scope}]</span>}
              <span className="whitespace-pre-wrap break-all text-foreground">{entry.message}</span>
            </div>
          ))}

          {hasMore && (
            <div className="flex justify-center py-3">
              <Button variant="outline" size="sm" onClick={loadMore}>
                Load older logs
              </Button>
            </div>
          )}
          {loading && entries.length === 0 && (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
