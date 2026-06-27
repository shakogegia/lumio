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
import { FileTypeFacet } from "./file-type-facet";
import { useExtensions } from "./use-extensions";

export function FilterPanel({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);
  const extensions = useExtensions(slug);

  const enabledGroups = (schema ?? [])
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.enabled) }))
    .filter((g) => g.fields.length > 0);

  // Hide the filter button only when there is nothing to filter on at all —
  // no configured metadata fields AND no file types present.
  if (enabledGroups.length === 0 && extensions.length === 0) return null;

  const activeCount = filters.rules.length;
  const setRules = (rules: SearchFilters["rules"]) => onChange({ ...filters, rules });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
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
        <div className="space-y-4">
          <FileTypeFacet extensions={extensions} rules={filters.rules} onRules={setRules} />
          {enabledGroups.length > 0 && (
            <MetadataFacets groups={enabledGroups} slug={slug} rules={filters.rules} onRules={setRules} />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
