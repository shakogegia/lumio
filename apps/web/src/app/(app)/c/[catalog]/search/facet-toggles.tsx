"use client";

import type { FilterRule } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { type Orientation, applyOrientation, applyToggle, readOrientation, readToggle } from "./panel-rules";

const ORIENTATIONS: Orientation[] = ["any", "portrait", "landscape"];

export function FacetToggles({ rules, onRules }: { rules: FilterRule[]; onRules: (next: FilterRule[]) => void }) {
  const hasGps = readToggle(rules, "hasGps");
  const orientation = readOrientation(rules);
  return (
    <section className="flex flex-col gap-3">
      <label className="flex items-center justify-between text-sm">
        Has location
        <Switch checked={hasGps} onCheckedChange={(on) => onRules(applyToggle(rules, "hasGps", on === true))} />
      </label>
      <div>
        <h3 className="mb-1 text-xs font-medium text-muted-foreground">Orientation</h3>
        <div className="flex gap-1">
          {ORIENTATIONS.map((o) => (
            <Button
              key={o}
              size="sm"
              variant={orientation === o ? "default" : "outline"}
              onClick={() => onRules(applyOrientation(rules, o))}
              className="capitalize"
            >
              {o}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}
