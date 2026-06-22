"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownUp, ChevronRight, File as FileIcon, Folder as FolderIcon, LayoutGrid, List, Search, SearchX } from "lucide-react";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Spinner } from "@/components/ui/spinner";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import {
  catalogBreadcrumbs,
  folderCountLabel,
  sortFolderItems,
  type CatalogDirChild,
  type CatalogFileChild,
  type CatalogListing,
  type FolderSort,
} from "@/lib/catalog-fs";
import type { CatalogSearchResult } from "@/lib/catalog-fs-service";
import { detailScopeQuery } from "@/lib/detail-scope";
import { DEFAULT_PHOTO_SORT, parentDir } from "@lumio/shared";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useFolderPrefs } from "@/lib/use-folder-prefs";
import type { FolderPrefs, FolderViewMode } from "@/lib/folder-prefs";

/** Build the /folders page href for a catalog-relative path ("" = root). */
function folderHref(slug: string, rel: string): string {
  const base = catalogPath(slug, "/folders");
  return rel ? `${base}?path=${encodeURIComponent(rel)}` : base;
}

/** Where a (possibly nested) entry lives, for search results: its parent path or "Library". */
function locationLabel(rel: string): string {
  return parentDir(rel) || "Library";
}

/** Detail-page href that scopes the lightbox film strip to the photo's own
 *  on-disk folder (its siblings), so prev/next stays within that directory. */
function photoDetailHref(
  slug: string,
  photoId: string,
  fileRel: string,
  _sort: FolderSort,
): string {
  const q = detailScopeQuery({
    kind: "folder",
    dir: parentDir(fileRel),
    sort: DEFAULT_PHOTO_SORT,
  });
  return catalogPath(slug, q ? `/photo/${photoId}?${q}` : `/photo/${photoId}`);
}

/** Segmented grid/list switch for the explorer layout. */
function ViewToggle({
  view,
  onViewChange,
}: {
  view: FolderViewMode;
  onViewChange: (view: FolderViewMode) => void;
}) {
  const options: { mode: FolderViewMode; icon: typeof List; label: string }[] = [
    { mode: "grid", icon: LayoutGrid, label: "Grid view" },
    { mode: "list", icon: List, label: "List view" },
  ];
  return (
    <div className="flex items-center rounded-md border border-border p-0.5">
      {options.map(({ mode, icon: Icon, label }) => (
        <button
          key={mode}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={view === mode}
          onClick={() => onViewChange(mode)}
          className={cn(
            "flex size-7 items-center justify-center rounded-sm transition-colors",
            view === mode
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </button>
      ))}
    </div>
  );
}

/** Dropdown to sort the listing by name or modified date. Grouped with labels +
 *  a separator, mirroring the photo grid's sort menu (GridSortMenu). */
function FolderSortMenu({
  sort,
  onSortChange,
}: {
  sort: FolderSort;
  onSortChange: (sort: FolderSort) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Sort" title="Sort">
          <ArrowDownUp />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuRadioGroup
          value={`${sort.field}:${sort.dir}`}
          onValueChange={(v) => {
            const [field, dir] = v.split(":");
            if ((field === "name" || field === "date") && (dir === "asc" || dir === "desc")) {
              onSortChange({ field, dir });
            }
          }}
        >
          <DropdownMenuLabel>Name</DropdownMenuLabel>
          <DropdownMenuRadioItem value="name:asc">A to Z</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="name:desc">Z to A</DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Date</DropdownMenuLabel>
          <DropdownMenuRadioItem value="date:desc">Newest first</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="date:asc">Oldest first</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Tile grid: folders + files as cards, density driven by `columns`. When
 *  `showPath` (search results), each tile's subtitle is its location. */
function GridItems({
  slug,
  dirs,
  files,
  columns,
  sort,
  showPath,
}: {
  slug: string;
  dirs: CatalogDirChild[];
  files: CatalogFileChild[];
  columns: number;
  sort: FolderSort;
  showPath?: boolean;
}) {
  return (
    <div
      className="grid gap-3"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {dirs.map((d) => (
        <Link
          key={d.rel}
          href={folderHref(slug, d.rel)}
          className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 text-center transition-colors hover:bg-muted"
        >
          <FolderIcon className="size-10 text-muted-foreground" aria-hidden />
          <span className="w-full truncate text-xs font-medium">{d.name}</span>
          <span className="w-full truncate text-[11px] text-muted-foreground">
            {showPath ? locationLabel(d.rel) : folderCountLabel(d.folderCount, d.fileCount)}
          </span>
        </Link>
      ))}

      {files.map((f) =>
        f.photoId ? (
          <Link
            key={f.rel}
            href={photoDetailHref(slug, f.photoId, f.rel, sort)}
            className="group flex flex-col gap-2 rounded-lg border border-border p-2 transition-colors hover:bg-muted"
          >
            <span className="aspect-square w-full overflow-hidden rounded bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={catalogApiUrl(slug, `/photos/${f.photoId}/thumbnail`)}
                alt={f.name}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            </span>
            <span className="w-full truncate text-xs">{f.name}</span>
            {showPath && (
              <span className="w-full truncate text-[11px] text-muted-foreground">
                {locationLabel(f.rel)}
              </span>
            )}
          </Link>
        ) : (
          <div
            key={f.rel}
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-4 text-center opacity-70"
          >
            <FileIcon className="size-10 text-muted-foreground" aria-hidden />
            <span className="w-full truncate text-xs">{f.name}</span>
            <span className="w-full truncate text-xs text-muted-foreground">
              {showPath ? locationLabel(f.rel) : formatBytes(f.size)}
            </span>
          </div>
        ),
      )}
    </div>
  );
}

/** Compact rows: folders + files in a single bordered list. */
function ListItems({
  slug,
  dirs,
  files,
  sort,
  showPath,
}: {
  slug: string;
  dirs: CatalogDirChild[];
  files: CatalogFileChild[];
  sort: FolderSort;
  showPath?: boolean;
}) {
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
      {dirs.map((d) => (
        <li key={d.rel}>
          <Link
            href={folderHref(slug, d.rel)}
            className="flex items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-muted"
          >
            <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">{d.name}</span>
            <span className="ml-auto shrink-0 text-muted-foreground">
              {showPath ? locationLabel(d.rel) : folderCountLabel(d.folderCount, d.fileCount)}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}

      {files.map((f) => (
        <li key={f.rel}>
          {f.photoId ? (
            <Link
              href={photoDetailHref(slug, f.photoId, f.rel, sort)}
              className="flex items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-muted"
            >
              <span className="size-9 shrink-0 overflow-hidden rounded bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={catalogApiUrl(slug, `/photos/${f.photoId}/thumbnail`)}
                  alt={f.name}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </span>
              <span className="truncate">{f.name}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">
                {showPath ? locationLabel(f.rel) : formatBytes(f.size)}
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-3 px-3 py-2 text-xs opacity-70">
              <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">
                {showPath ? locationLabel(f.rel) : formatBytes(f.size)}
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Disk-explorer view: a shadcn breadcrumb + a toolbar (search, sort, grid-size,
 * grid/list switch) over the folder/file listing. Toolbar prefs are seeded from
 * a cookie (server-rendered) so there's no hydration flicker. Search recurses
 * into nested subfolders via the /fs/search endpoint. Indexed photos open in the
 * lightbox; other files are non-openable.
 */
export function FolderExplorer({
  slug,
  listing,
  initialPrefs,
}: {
  slug: string;
  listing: CatalogListing;
  initialPrefs: FolderPrefs;
}) {
  const crumbs = catalogBreadcrumbs(listing.rel);
  const isEmpty = listing.dirs.length === 0 && listing.files.length === 0;
  const { prefs, update } = useFolderPrefs(initialPrefs);
  const { view, columns, sort } = prefs;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogSearchResult | null>(null);
  const [searching, setSearching] = useState(false);

  const trimmed = query.trim();
  const searchActive = trimmed !== "";

  // Recursive search (debounced) against the current folder's subtree. Stale
  // requests are aborted; the display gates on `searching` so old matches never
  // flash while a newer query is in flight.
  useEffect(() => {
    if (trimmed === "") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const url = catalogApiUrl(
        slug,
        `/fs/search?path=${encodeURIComponent(listing.rel)}&q=${encodeURIComponent(trimmed)}`,
      );
      fetch(url, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((data: CatalogSearchResult) => {
          if (!cancelled) setResults(data);
        })
        .catch(() => {
          if (!cancelled) setResults({ dirs: [], files: [], truncated: false });
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed, slug, listing.rel]);

  const baseDirs = searchActive ? (results?.dirs ?? []) : listing.dirs;
  const baseFiles = searchActive ? (results?.files ?? []) : listing.files;
  const dirs = sortFolderItems(baseDirs, sort);
  const files = sortFolderItems(baseFiles, sort);

  return (
    <div>
      <div className="sticky top-0 z-20 -mx-4 flex items-center justify-between gap-3 bg-background px-4 py-2">
        <Breadcrumb>
          <BreadcrumbList>
            {crumbs.map((c, i) => {
              const isLast = i === crumbs.length - 1;
              return (
                <Fragment key={c.rel}>
                  <BreadcrumbItem>
                    {isLast ? (
                      <BreadcrumbPage>{c.name}</BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink asChild>
                        <Link href={folderHref(slug, c.rel)}>{c.name}</Link>
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbItem>
                  {!isLast && <BreadcrumbSeparator />}
                </Fragment>
              );
            })}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="flex shrink-0 items-center gap-2">
          <InputGroup className="h-8 w-44 sm:w-56">
            <InputGroupAddon>
              {searching ? <Spinner /> : <Search />}
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search folders & files…"
              aria-label="Search folders and files"
            />
            {searchActive && (
              <InputGroupAddon align="inline-end" className="text-xs text-muted-foreground">
                {searching ? "…" : `${dirs.length + files.length} found`}
              </InputGroupAddon>
            )}
          </InputGroup>
          <FolderSortMenu sort={sort} onSortChange={(s) => update({ sort: s })} />
          {view === "grid" && (
            <GridSizeMenu columns={columns} onColumnsChange={(c) => update({ columns: c })} />
          )}
          <ViewToggle view={view} onViewChange={(v) => update({ view: v })} />
        </div>
      </div>

      {searchActive ? (
        searching ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Spinner className="size-6" />
              </EmptyMedia>
              <EmptyTitle>Searching…</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : dirs.length === 0 && files.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SearchX />
              </EmptyMedia>
              <EmptyTitle>No matches</EmptyTitle>
              <EmptyDescription>Nothing here matches “{trimmed}”.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="space-y-3">
            {view === "grid" ? (
              <GridItems slug={slug} dirs={dirs} files={files} columns={columns} sort={sort} showPath />
            ) : (
              <ListItems slug={slug} dirs={dirs} files={files} sort={sort} showPath />
            )}
            {results?.truncated && (
              <p className="text-xs text-muted-foreground">
                Showing the first {dirs.length + files.length} matches — refine your search.
              </p>
            )}
          </div>
        )
      ) : isEmpty ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderIcon />
            </EmptyMedia>
            <EmptyTitle>This folder is empty</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : view === "grid" ? (
        <GridItems slug={slug} dirs={dirs} files={files} columns={columns} sort={sort} />
      ) : (
        <ListItems slug={slug} dirs={dirs} files={files} sort={sort} />
      )}
    </div>
  );
}
