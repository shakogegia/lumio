"use client";

import type { FilterRule } from "@lumio/shared";
import { MatchType } from "@lumio/shared";
import { Switch } from "@/components/ui/switch";
import { useCatalog } from "@/components/providers/catalog-context";
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import { MetadataFacets } from "../search/metadata-facets";

export type SmartRulesValue = { match: MatchType; rules: FilterRule[] };

export function SmartAlbumRulesEditor({
  value,
  onChange,
}: {
  value: SmartRulesValue;
  onChange: (next: SmartRulesValue) => void;
}) {
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);
  const enabledGroups = (schema ?? [])
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.enabled) }))
    .filter((g) => g.fields.length > 0);

  if (schema === undefined) return null; // still loading — don't flash the empty-state hint

  if (enabledGroups.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This catalog has no metadata fields to filter on. Add fields in Settings
        → Metadata first.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium">Rules</span>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Match any
          <Switch
            checked={value.match === MatchType.any}
            onCheckedChange={(any) =>
              onChange({
                ...value,
                match: any ? MatchType.any : MatchType.all,
              })
            }
          />
        </label>
      </div>
      <div className="max-h-[50vh] overflow-y-auto pr-1">
        <MetadataFacets
          groups={enabledGroups}
          slug={slug}
          rules={value.rules}
          onRules={(rules) => onChange({ ...value, rules })}
        />
      </div>
    </div>
  );
}
