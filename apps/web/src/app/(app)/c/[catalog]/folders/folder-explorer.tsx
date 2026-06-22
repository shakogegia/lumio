"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { ArrowDownUp, ChevronRight, File as FileIcon, Folder as FolderIcon, LayoutGrid, List, Search } from "lucide-react";
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
import { GridSizeMenu } from "@/components/grid-size-menu";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import {
  catalogBreadcrumbs,
  filterByName,
  folderCountLabel,
  sortFolderItems,
  type CatalogDirChild,
  type CatalogFileChild,
  type CatalogListing,
  type FolderSort,
} from "@/lib/catalog-fs";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useFolderColumns } from "@/lib/use-folder-columns";
import { useFolderSort } from "@/lib/use-folder-sort";
import { useFolderView, type FolderViewMode } from "@/lib/use-folder-view";

/** Build the /folders page href for a catalog-relative path ("" = root). */
function folderHref(slug: string, rel: string): string {
  const base = catalogPath(slug, "/folders");
  return rel ? `${base}?path=${encodeURIComponent(rel)}` : base;
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

/** Tile grid: folders + files as cards, density driven by `columns`. */
function GridItems({
  slug,
  dirs,
  files,
}: {
  slug: string;
  dirs: CatalogDirChild[];
  files: CatalogFileChild[];
}) {
  const { columns } = useFolderColumns();
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
            {folderCountLabel(d.folderCount, d.fileCount)}
          </span>
        </Link>
      ))}

      {files.map((f) =>
        f.photoId ? (
          <Link
            key={f.rel}
            href={catalogPath(slug, `/photo/${f.photoId}`)}
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
          </Link>
        ) : (
          <div
            key={f.rel}
            className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border p-4 text-center opacity-70"
          >
            <FileIcon className="size-10 text-muted-foreground" aria-hidden />
            <span className="w-full truncate text-xs">{f.name}</span>
            <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
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
}: {
  slug: string;
  dirs: CatalogDirChild[];
  files: CatalogFileChild[];
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
              {folderCountLabel(d.folderCount, d.fileCount)}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </Link>
        </li>
      ))}

      {files.map((f) => (
        <li key={f.rel}>
          {f.photoId ? (
            <Link
              href={catalogPath(slug, `/photo/${f.photoId}`)}
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
              <span className="ml-auto shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
            </Link>
          ) : (
            <div className="flex items-center gap-3 px-3 py-2 text-xs opacity-70">
              <FileIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{f.name}</span>
              <span className="ml-auto shrink-0 text-muted-foreground">{formatBytes(f.size)}</span>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Disk-explorer view: a shadcn breadcrumb + a toolbar (grid-size in grid mode,
 * plus a grid/list switch) over the folder/file listing. Indexed photos render
 * a thumbnail and open in the lightbox; other files are non-openable.
 */
export function FolderExplorer({
  slug,
  listing,
}: {
  slug: string;
  listing: CatalogListing;
}) {
  const crumbs = catalogBreadcrumbs(listing.rel);
  const isEmpty = listing.dirs.length === 0 && listing.files.length === 0;
  const { columns, setColumns } = useFolderColumns();
  const { view, setView } = useFolderView();
  const { sort, setSort } = useFolderSort();
  const [query, setQuery] = useState("");
  const dirs = filterByName(sortFolderItems(listing.dirs, sort), query);
  const files = filterByName(sortFolderItems(listing.files, sort), query);
  const noMatches = !isEmpty && dirs.length === 0 && files.length === 0;

  return (
    <div className="space-y-6">
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
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search this folder…"
              aria-label="Search this folder"
            />
            {query.trim() !== "" && (
              <InputGroupAddon align="inline-end" className="text-xs text-muted-foreground">
                {dirs.length + files.length} found
              </InputGroupAddon>
            )}
          </InputGroup>
          <FolderSortMenu sort={sort} onSortChange={setSort} />
          {view === "grid" && <GridSizeMenu columns={columns} onColumnsChange={setColumns} />}
          <ViewToggle view={view} onViewChange={setView} />
        </div>
      </div>

      {isEmpty ? (
        <p className="text-sm text-muted-foreground">This folder is empty.</p>
      ) : noMatches ? (
        <p className="text-sm text-muted-foreground">Nothing here matches “{query}”.</p>
      ) : view === "grid" ? (
        <GridItems slug={slug} dirs={dirs} files={files} />
      ) : (
        <ListItems slug={slug} dirs={dirs} files={files} />
      )}
    </div>
  );
}
