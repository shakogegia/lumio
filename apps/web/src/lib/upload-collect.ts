import { SUPPORTED_EXTENSIONS } from "@lumio/ingest";

/** A directory reader; yields children in batches until an empty batch. */
export interface EntryReader {
  readEntries: (onEntries: (entries: FsEntry[]) => void, onErr?: (e: unknown) => void) => void;
}

/** Minimal subset of the browser FileSystemEntry API we rely on (kept small so it's testable). */
export interface FsEntry {
  isFile: boolean;
  isDirectory: boolean;
  file?: (onFile: (f: File) => void, onErr?: (e: unknown) => void) => void;
  createReader?: () => EntryReader;
}

export function isSupported(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  return SUPPORTED_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}

export function partitionSupported(files: File[]): { supported: File[]; skipped: number } {
  const supported = files.filter((f) => isSupported(f.name));
  return { supported, skipped: files.length - supported.length };
}

function entryToFile(entry: FsEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file!(resolve, reject));
}

/** readEntries yields children in batches; call until it returns an empty batch. */
function readAllEntries(reader: EntryReader): Promise<FsEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FsEntry[] = [];
    const pump = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          pump();
        }
      }, reject);
    pump();
  });
}

export async function collectFromEntries(entries: FsEntry[]): Promise<File[]> {
  const files: File[] = [];
  for (const entry of entries) {
    try {
      if (entry.isFile && entry.file) {
        files.push(await entryToFile(entry));
      } else if (entry.isDirectory && entry.createReader) {
        const children = await readAllEntries(entry.createReader());
        files.push(...(await collectFromEntries(children)));
      }
    } catch {
      // Skip unreadable entries (deleted mid-drag, permission denied, etc.)
      // rather than aborting the whole dropped-folder collection.
    }
  }
  return files;
}

/**
 * Flatten a drop's DataTransfer into a File[]. Captures directory entries
 * synchronously (they expire once the drop event returns), then traverses.
 * Falls back to `dataTransfer.files` when the entries API is unavailable.
 */
export async function collectFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  const entries = items
    .map((it) =>
      typeof (it as DataTransferItem & { webkitGetAsEntry?: () => FileSystemEntry | null })
        .webkitGetAsEntry === "function"
        ? (it as DataTransferItem & { webkitGetAsEntry: () => FileSystemEntry | null }).webkitGetAsEntry()
        : null,
    )
    .filter((e): e is FileSystemEntry => e !== null) as unknown as FsEntry[];
  if (entries.length > 0) return collectFromEntries(entries);
  return Array.from(dataTransfer.files ?? []);
}
