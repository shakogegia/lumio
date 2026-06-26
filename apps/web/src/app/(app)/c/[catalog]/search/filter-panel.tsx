"use client";

import { SlidersHorizontal } from "lucide-react";
import { MatchType } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { SearchFilters } from "./filters";
import { FacetMultiselect } from "./facet-multiselect";
import { FacetRange } from "./facet-range";
import { FacetDate } from "./facet-date";
import { FacetToggles } from "./facet-toggles";
import { FacetGeneric } from "./facet-generic";

export function FilterPanel({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
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
        <div className="flex flex-col gap-4">
          <FacetMultiselect label="Camera" field="camera" fieldKey="cameraModel" rules={filters.rules} onRules={setRules} />
          <FacetMultiselect label="Lens" field="lens" fieldKey="lensModel" rules={filters.rules} onRules={setRules} />
          <FacetRange label="ISO" fieldKey="iso" rules={filters.rules} onRules={setRules} />
          <FacetRange label="Aperture" fieldKey="aperture" step="0.1" rules={filters.rules} onRules={setRules} />
          <FacetRange label="Focal length (mm)" fieldKey="focalLength" rules={filters.rules} onRules={setRules} />
          <FacetDate rules={filters.rules} onRules={setRules} />
          <FacetToggles rules={filters.rules} onRules={setRules} />
          <FacetGeneric rules={filters.rules} onRules={setRules} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
