import Link from "next/link";
import { Folder as FolderIcon } from "lucide-react";
import { catalogPath } from "@/lib/catalog-api";
import type { Subfolder } from "@/lib/catalog-fs-service";

function folderHref(slug: string, rel: string): string {
  return `${catalogPath(slug, "/folders")}?path=${encodeURIComponent(rel)}`;
}

/** Subfolder tiles above the photo grid; hidden when there are none. */
export function FoldersSection({ slug, dirs }: { slug: string; dirs: Subfolder[] }) {
  if (dirs.length === 0) return null;
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-medium text-muted-foreground">Folders</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {dirs.map((d) => (
          <Link
            key={d.rel}
            href={folderHref(slug, d.rel)}
            className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 text-center transition-colors hover:bg-muted"
          >
            <FolderIcon className="size-10 text-muted-foreground" aria-hidden />
            <span className="w-full truncate text-xs font-medium">{d.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
