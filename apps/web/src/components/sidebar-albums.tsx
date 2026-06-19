"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Images } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { NavLink, type NavItem } from "@/components/sidebar-nav-link";

export function SidebarAlbums({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  const [albums, setAlbums] = useState<AlbumSummaryDTO[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/albums")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((data: { items: AlbumSummaryDTO[] }) => setAlbums(data.items))
      .catch(() => {
        // Leave the list empty; the flyout simply won't open.
      });
  }, []);

  // Load once on mount so the first hover can open immediately.
  useEffect(() => {
    load();
  }, [load]);

  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        // Refresh on each open so a newly-created album shows up...
        if (next) load();
        // ...and never open when there are no albums (empty guard).
        setOpen(next && albums.length > 0);
      }}
      openDelay={120}
      closeDelay={100}
    >
      <HoverCardTrigger asChild>
        <NavLink item={item} active={active} />
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="center"
        sideOffset={8}
        className="max-h-[360px] overflow-y-auto"
      >
        <ul role="list">
          {albums.map((album) => (
            <li key={album.id}>
              <Link
                href={`/albums/${album.id}`}
                className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-muted"
              >
                <div className="flex aspect-[4/3] w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
                  {album.coverPhotoId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/thumbnails/${album.coverPhotoId}`}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Images className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{album.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {album.photoCount}{" "}
                    {album.photoCount === 1 ? "photo" : "photos"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}
