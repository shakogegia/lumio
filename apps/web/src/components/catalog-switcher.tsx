"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Plus, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
import { WorkerActivity } from "@/components/worker-activity";
import { CreateCatalogDialog } from "@/components/create-catalog-dialog";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";

interface CatalogOption {
  id: string;
  slug: string;
  name: string;
}

/**
 * Catalog switcher for the narrow sidebar rail. The Lumio brand logo (which also
 * surfaces worker activity) IS the trigger: hovering it opens a flyout listing
 * every catalog (the active one checked). Picking another navigates to its
 * Photos page; "New catalog…" opens the create dialog and "Manage catalogs"
 * links to the management page. Uses a HoverCard (open-on-hover) to match the
 * Albums flyout. The list is fetched once from the global `/api/catalogs` route
 * — the switcher seeds itself with the active catalog so it always shows at
 * least one option before the fetch resolves.
 */
export function CatalogSwitcher() {
  const current = useCatalog();
  const router = useRouter();
  const [catalogs, setCatalogs] = useState<CatalogOption[]>([
    { id: current.id, slug: current.slug, name: current.name },
  ]);
  // The create dialog owns its open state; the switcher just toggles it.
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/catalogs");
        if (!res.ok) return;
        const data: CatalogOption[] = await res.json();
        if (!cancelled && Array.isArray(data) && data.length > 0) setCatalogs(data);
      } catch {
        // Keep the seeded single-catalog list on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const rowClass =
    "flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm transition-colors hover:bg-muted";

  return (
    <>
      <HoverCard openDelay={80} closeDelay={120}>
        <HoverCardTrigger asChild>
          <button
            type="button"
            title={`Catalog: ${current.name}`}
            aria-label={`Catalog: ${current.name}. Switch catalog`}
            className={cn(
              "group mt-5 flex h-11 w-11 items-center justify-center rounded-2xl text-foreground outline-none transition-colors",
              "hover:bg-muted data-[state=open]:bg-muted",
            )}
          >
            <WorkerActivity />
            <span className="sr-only">Switch catalog ({current.name})</span>
          </button>
        </HoverCardTrigger>

        <HoverCardContent side="right" align="start" sideOffset={8} className="w-56 p-1">
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Catalogs</p>
          <ul role="list">
            {catalogs.map((c) => {
              const active = c.slug === current.slug;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!active) router.push(catalogPath(c.slug, "/photos"));
                    }}
                    className={rowClass}
                  >
                    <Check
                      className={cn("size-4 shrink-0", active ? "opacity-100" : "opacity-0")}
                      aria-hidden
                    />
                    <span className="truncate">{c.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="my-1 h-px bg-border" role="separator" />

          <button type="button" onClick={() => setCreateOpen(true)} className={rowClass}>
            <Plus className="size-4 shrink-0" aria-hidden />
            New catalog…
          </button>
          <Link href="/catalogs" className={rowClass}>
            <Settings2 className="size-4 shrink-0" aria-hidden />
            Manage catalogs
          </Link>
        </HoverCardContent>
      </HoverCard>

      <CreateCatalogDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(catalog) => router.push(catalogPath(catalog.slug, "/photos"))}
      />
    </>
  );
}
