"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Library, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
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
 * Compact catalog switcher for the narrow sidebar rail: an icon button that
 * opens a dropdown listing every catalog (the active one checked). Picking
 * another navigates to its Photos page; a "Manage catalogs" entry links to the
 * (Phase 4) management page. The list is fetched once from the global
 * `/api/catalogs` route — the switcher seeds itself with the active catalog so
 * it always shows at least one option before the fetch resolves.
 */
export function CatalogSwitcher() {
  const current = useCatalog();
  const router = useRouter();
  const [catalogs, setCatalogs] = useState<CatalogOption[]>([
    { id: current.id, slug: current.slug, name: current.name },
  ]);

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
        title="Switch catalog"
        aria-label={`Catalog: ${current.name}`}
        className={cn(
          "group flex h-10 w-10 items-center justify-center rounded-2xl outline-none transition-colors",
          "text-muted-foreground hover:bg-muted hover:text-foreground",
          "data-[state=open]:bg-muted data-[state=open]:text-foreground",
        )}
      >
        <Library
          className="h-[22px] w-[22px] transition-transform duration-200 group-active:scale-90"
          strokeWidth={1.8}
          aria-hidden
        />
        <span className="sr-only">Switch catalog</span>
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
        <DropdownMenuItem asChild>
          <Link href="/catalogs">
            <Plus aria-hidden />
            Manage catalogs
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
