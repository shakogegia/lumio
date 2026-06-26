"use client";

import { SlidersHorizontal } from "lucide-react";
import { MatchType } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useCatalog } from "@/components/providers/catalog-context";
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import type { SearchFilters } from "./filters";
import { MetadataFacets } from "./metadata-facets";

export function FilterPanel({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);

  const enabledGroups = (schema ?? [])
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.enabled) }))
    .filter((g) => g.fields.length > 0);

  // No configured metadata fields → hide the filter button entirely.
  if (enabledGroups.length === 0) return null;

  const activeCount = filters.rules.length;
  const setRules = (rules: SearchFilters["rules"]) => onChange({ ...filters, rules });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <SlidersHorizontal aria-hidden />
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-[70vh] overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">Filters</span>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Match any
            <Switch
              checked={filters.match === MatchType.any}
              onCheckedChange={(any) =>
                onChange({ ...filters, match: any ? MatchType.any : MatchType.all })
              }
            />
          </label>
        </div>
        <MetadataFacets
          groups={enabledGroups}
          slug={slug}
          rules={filters.rules}
          onRules={setRules}
        />
      </PopoverContent>
    </Popover>
  );
}
