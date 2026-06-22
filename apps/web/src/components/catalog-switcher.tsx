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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CatalogOption {
  id: string;
  slug: string;
  name: string;
}

/**
 * Catalog switcher for the narrow sidebar rail. The Lumio brand logo (which also
 * surfaces worker activity) IS the dropdown trigger: clicking it lists every
 * catalog (the active one checked). Picking another navigates to its Photos
 * page; "New catalog…" opens the create dialog and "Manage catalogs" links to
 * the management page. The list is fetched once from the global `/api/catalogs`
 * route — the switcher seeds itself with the active catalog so it always shows
 * at least one option before the fetch resolves.
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        title={`Catalog: ${current.name} — switch`}
        aria-label={`Catalog: ${current.name}. Switch catalog`}
        className={cn(
          "group mt-5 flex h-11 w-11 items-center justify-center rounded-2xl text-foreground outline-none transition-colors",
          "hover:bg-muted data-[state=open]:bg-muted",
        )}
      >
        <WorkerActivity />
        <span className="sr-only">Switch catalog ({current.name})</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="right" align="start" sideOffset={8} className="w-56">
        <DropdownMenuLabel>Catalogs</DropdownMenuLabel>
        {catalogs.map((c) => {
          const active = c.slug === current.slug;
          return (
            <DropdownMenuItem
              key={c.id}
              onSelect={() => {
                if (!active) router.push(catalogPath(c.slug, "/photos"));
              }}
            >
              <Check className={cn("size-4", active ? "opacity-100" : "opacity-0")} aria-hidden />
              <span className="truncate">{c.name}</span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
          <Plus aria-hidden />
          New catalog…
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/catalogs">
            <Settings2 aria-hidden />
            Manage catalogs
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>

      <CreateCatalogDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(catalog) => router.push(catalogPath(catalog.slug, "/photos"))}
      />
    </DropdownMenu>
  );
}
