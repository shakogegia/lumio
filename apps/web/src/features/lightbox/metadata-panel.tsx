// apps/web/src/features/lightbox/metadata-panel.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { PhotoDTO, ResolvedGroup } from "@lumio/shared";
import { FieldKind } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { MetadataFieldRow } from "./metadata-field-row";

export function MetadataPanel({ photo }: { photo: PhotoDTO }) {
  const { slug } = useCatalog();
  const [groups, setGroups] = useState<ResolvedGroup[] | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(catalogApiUrl(slug, `/metadata/photo/${photo.id}`));
    if (!r.ok) {
      setGroups([]);
      return;
    }
    const data = (await r.json()) as { groups: ResolvedGroup[] };
    setGroups(data.groups);
  }, [slug, photo.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (groups === null) return null; // first load

  // Filter to custom fields only; skip groups left empty after filtering.
  const customGroups = groups
    .map((g) => ({
      ...g,
      fields: g.fields.filter((f) => f.kind === FieldKind.Custom),
    }))
    .filter((g) => g.fields.length > 0);

  if (customGroups.length === 0) return null;

  return (
    <div className="space-y-4">
      {customGroups.map((group) => (
        <div key={group.id} className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </p>
          {group.fields.map((field) => (
            <MetadataFieldRow key={field.id} slug={slug} photoId={photo.id} field={field} />
          ))}
        </div>
      ))}
    </div>
  );
}
