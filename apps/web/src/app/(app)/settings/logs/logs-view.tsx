"use client";

import { useMemo, useState } from "react";
import { LOG_LEVELS, LogLevel } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useLogs, type SinceFilter } from "@/lib/hooks/use-logs";

const LEVEL_LABEL: Record<LogLevel, string> = {
  [LogLevel.Error]: "Error",
  [LogLevel.Warn]: "Warn",
  [LogLevel.Info]: "Info",
  [LogLevel.Debug]: "Debug",
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

  // Derive a stable, sorted level list from the toggle set.
  const levels = useMemo(() => LOG_LEVELS.filter((l) => active.has(l)), [active]);
  const { entries, loading, hasMore, loadMore } = useLogs(levels, since);

  const toggle = (level: LogLevel) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {LOG_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => toggle(level)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                active.has(level)
                  ? "border-transparent bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={active.has(level)}
            >
              {LEVEL_LABEL[level]}
            </button>
          ))}
        </div>
        <div className="ml-auto flex gap-1">
          {SINCE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSince(opt.value)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                since === opt.value ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={since === opt.value}
            >
              {opt.label}
            </button>
          ))}
        </div>
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
