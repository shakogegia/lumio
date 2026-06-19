"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { collectFiles } from "@/lib/upload-collect";

/**
 * Drop target + file/folder pickers. `hero` is the large empty-state panel;
 * `slim` is the compact "drop more" bar shown once files exist. Both report
 * collected files via `onFiles`.
 */
export function UploadDropzone({
  variant,
  onFiles,
}: {
  variant: "hero" | "slim";
  onFiles: (files: File[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void collectFiles(e.dataTransfer).then(onFiles);
    },
  };

  const inputs = (
    <>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,.jxl,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {/* No `accept`: browsers ignore it with webkitdirectory; partitionSupported filters instead. */}
      <input
        ref={folderRef}
        type="file"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </>
  );

  if (variant === "slim") {
    return (
      <div
        {...dragProps}
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground transition-colors",
          dragging ? "border-foreground bg-muted" : "border-border",
        )}
      >
        <UploadCloud className="size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-medium text-foreground">Drop more</span> here,{" "}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-primary underline-offset-4 hover:underline"
          >
            browse files
          </button>{" "}
          or{" "}
          <button
            type="button"
            onClick={() => folderRef.current?.click()}
            className="text-primary underline-offset-4 hover:underline"
          >
            add a folder
          </button>
        </span>
        {inputs}
      </div>
    );
  }

  return (
    <div
      {...dragProps}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-16 text-center transition-colors",
        dragging ? "border-foreground bg-muted" : "border-border",
      )}
    >
      <UploadCloud className="size-10 text-muted-foreground" strokeWidth={1.6} aria-hidden />
      <p className="text-sm font-medium">Drag photos or a folder here</p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={() => fileRef.current?.click()}>
          Browse files
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => folderRef.current?.click()}>
          Add a folder
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">JPEG · PNG · WebP · HEIC · HEIF · JXL</p>
      {inputs}
    </div>
  );
}
