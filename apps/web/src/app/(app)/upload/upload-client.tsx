"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";
import { collectFiles, partitionSupported } from "@/lib/upload-collect";

type RowStatus = "queued" | "uploading" | "added" | "duplicate" | "unsupported" | "error";

interface Row {
  id: number;
  name: string;
  status: RowStatus;
  message?: string;
}

const CONCURRENCY = 3;

const LABEL: Record<RowStatus, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  added: "Added",
  duplicate: "Already in library",
  unsupported: "Unsupported format",
  error: "Failed",
};

let nextRowId = 1;

export function UploadClient() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const [skipped, setSkipped] = useState(0);

  const update = useCallback((id: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const uploadOne = useCallback(
    async (file: File, rowId: number) => {
      update(rowId, { status: "uploading" });
      const body = new FormData();
      body.set("file", file);
      body.set("lastModified", String(file.lastModified));
      try {
        const res = await fetch("/api/uploads", { method: "POST", body });
        const data: { status: RowStatus; message?: string } = await res.json();
        update(rowId, { status: data.status, message: data.message });
      } catch (err) {
        update(rowId, { status: "error", message: (err as Error).message });
      }
    },
    [update],
  );

  const addFiles = useCallback(
    async (incoming: File[]) => {
      const { supported: files, skipped: nSkipped } = partitionSupported(incoming);
      if (nSkipped > 0) setSkipped((n) => n + nSkipped);
      if (files.length === 0) return;
      const queued: Array<{ file: File; rowId: number }> = files.map((file) => {
        const rowId = nextRowId++;
        return { file, rowId };
      });
      setRows((prev) => [
        ...queued.map(({ file, rowId }) => ({ id: rowId, name: file.name, status: "queued" as const })),
        ...prev,
      ]);

      // Bounded-concurrency worker pool.
      let cursor = 0;
      async function worker() {
        while (cursor < queued.length) {
          const item = queued[cursor++];
          if (item) await uploadOne(item.file, item.rowId);
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, worker));
      router.refresh();
    },
    [router, uploadOne],
  );

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void collectFiles(e.dataTransfer).then(addFiles);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-16 transition-colors",
          dragging ? "border-foreground bg-muted" : "border-border hover:bg-muted/50",
        )}
      >
        <UploadCloud className="h-10 w-10 text-muted-foreground" strokeWidth={1.6} aria-hidden />
        <span className="text-sm text-muted-foreground">
          Drag photos or a folder here, or click to choose files
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.jxl,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <input
        ref={folderInputRef}
        type="file"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      <div className="flex justify-center">
        <button
          type="button"
          onClick={() => folderInputRef.current?.click()}
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Or upload a whole folder
        </button>
      </div>

      {skipped > 0 && (
        <p className="text-sm text-muted-foreground">
          Skipped {skipped} unsupported file{skipped === 1 ? "" : "s"}.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
              <span className="truncate font-mono">{row.name}</span>
              <span
                className={cn(
                  "shrink-0",
                  row.status === "added" && "text-foreground",
                  (row.status === "error" || row.status === "unsupported") && "text-destructive",
                  (row.status === "queued" ||
                    row.status === "uploading" ||
                    row.status === "duplicate") &&
                    "text-muted-foreground",
                )}
              >
                {row.message && (row.status === "error" || row.status === "unsupported")
                  ? row.message
                  : LABEL[row.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
