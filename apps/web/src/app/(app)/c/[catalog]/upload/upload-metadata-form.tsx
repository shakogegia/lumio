"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MetadataFieldDef } from "@lumio/shared";
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import { useCatalog } from "@/components/providers/catalog-context";
import { MetadataValueInput } from "@/components/metadata/metadata-value-input";
import { MetadataFieldsList } from "@/components/metadata/metadata-fields-list";
import { Skeleton } from "@/components/ui/skeleton";
import { postJson } from "@/lib/http";
import { catalogApiUrl } from "@/lib/catalog-api";
import { cn } from "@/lib/utils";

type Aggregated = Record<string, { value: string; mixed: boolean }>;

/**
 * Selection-bound metadata editor for the upload page. It mirrors the grid
 * selection like Lightroom's metadata panel: it loads the selected photos'
 * stored values, shows the shared value (or "Mixed" when they differ), and
 * commits each edit to every selected photo. Nothing is a shared scratchpad —
 * re-selecting a photo always shows what was actually saved to it.
 */
export function UploadMetadataForm({ selectedIds }: { selectedIds: Set<string> }) {
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);
  // Stable signature of the selection — drives reloads and is split back to ids.
  const selKey = [...selectedIds].sort().join(",");
  const noSelection = selectedIds.size === 0;

  // Aggregated values tagged with the selection they were loaded for. While the
  // tag doesn't match the current selection the panel is "loading" (skeletons) —
  // derived, so the effect never has to reset state synchronously.
  const [loaded, setLoaded] = useState<{ key: string; values: Aggregated } | null>(null);
  const loading = !noSelection && loaded?.key !== selKey;

  useEffect(() => {
    if (!selKey) return;
    let alive = true;
    postJson(catalogApiUrl(slug, "/metadata/selection"), { photoIds: selKey.split(",") })
      .then((r) => r.json() as Promise<{ values: Aggregated }>)
      .then((d) => {
        if (alive) setLoaded({ key: selKey, values: d.values ?? {} });
      })
      .catch(() => {
        if (alive) setLoaded({ key: selKey, values: {} });
      });
    return () => {
      alive = false;
    };
  }, [selKey, slug]);

  const groups = (schema ?? [])
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.enabled) }))
    .filter((g) => g.fields.length > 0);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">Metadata</p>
        <p className="text-xs text-muted-foreground">
          {noSelection
            ? "Select photos to fill in metadata."
            : `Editing ${selectedIds.size} selected photo${selectedIds.size === 1 ? "" : "s"}. Changes apply to all.`}
        </p>
      </div>
      <fieldset disabled={noSelection} className={cn(noSelection && "opacity-50")}>
        <MetadataFieldsList
          groups={groups}
          renderValue={(field) => {
            // Nothing selected: show inert placeholders (the fieldset disables them).
            if (noSelection) {
              return (
                <MetadataValueInput
                  slug={slug}
                  fieldId={field.id}
                  type={field.type}
                  options={field.options}
                  suggests={field.suggests}
                  value=""
                  onChange={() => {}}
                />
              );
            }
            if (loading || !loaded) return <Skeleton className="h-7 w-40" />;
            // Keyed by selection so switching photos remounts with fresh values.
            return (
              <SelectionMetadataField
                key={`${selKey}:${field.id}`}
                slug={slug}
                photoIds={selKey.split(",")}
                field={field}
                initial={loaded.values[field.id]}
              />
            );
          }}
        />
      </fieldset>
    </div>
  );
}

/**
 * One field's value slot bound to a selection of photos. Seeded from the
 * aggregated load — a shared value, or empty with a "Mixed" placeholder when the
 * photos disagree. Editing commits to every selected photo. A mixed field is
 * only written once the user actually types: blurring it untouched must never
 * overwrite the differing values with empty.
 */
function SelectionMetadataField({
  slug,
  photoIds,
  field,
  initial,
}: {
  slug: string;
  photoIds: string[];
  field: MetadataFieldDef;
  initial?: { value: string; mixed: boolean };
}) {
  const startMixed = initial?.mixed ?? false;
  const [value, setValue] = useState(initial?.value ?? "");
  const saved = useRef(initial?.value ?? "");
  const mixed = useRef(startMixed);

  async function save(next: string = value) {
    if (mixed.current) {
      if (next.trim() === "") return; // never wipe differing values on a bare blur
    } else if (next === saved.current) {
      return; // unchanged
    }
    saved.current = next;
    mixed.current = false;
    try {
      await postJson(
        catalogApiUrl(slug, "/metadata/selection"),
        { photoIds, fieldId: field.id, value: next },
        "PUT",
      );
    } catch {
      toast.error("Failed to save metadata.");
    }
  }

  return (
    <MetadataValueInput
      slug={slug}
      fieldId={field.id}
      type={field.type}
      options={field.options}
      suggests={field.suggests}
      value={value}
      placeholder={startMixed ? "Mixed" : "—"}
      onChange={setValue}
      onCommit={save}
    />
  );
}
