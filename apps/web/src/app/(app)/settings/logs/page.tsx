import type { Metadata } from "next";
import { LogsView } from "./logs-view";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Logs" };

export default function LogsSettingsPage() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 p-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
        <p className="text-sm text-muted-foreground">
          Recent worker activity — ingestion, the file watcher, and background jobs.
          Kept to the last 10,000 entries (max 7 days).
        </p>
      </div>
      <LogsView />
    </main>
  );
}
