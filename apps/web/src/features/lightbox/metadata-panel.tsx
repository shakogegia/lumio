// apps/web/src/features/lightbox/metadata-panel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { PhotoDTO, ResolvedField, ResolvedGroup } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { Skeleton } from "@/components/ui/skeleton";
import { MetadataFieldsList } from "@/components/metadata/metadata-fields-list";
import { useCatalogMetadataSchema } from "./use-metadata-schema";
import { MetadataValueField } from "./metadata-field-row";

export function MetadataPanel({ photo }: { photo: PhotoDTO }) {
  const { slug } = useCatalog();
  // Field *structure* — cached, so it renders instantly on subsequent photos.
  const schema = useCatalogMetadataSchema(slug);
  // Per-photo *values* — load async; null while loading (→ skeletons).
  const [resolved, setResolved] = useState<Map<string, ResolvedField> | null>(null);

  useEffect(() => {
    let alive = true;
    setResolved(null);
    fetch(catalogApiUrl(slug, `/metadata/photo/${photo.id}`))
      .then((r) => (r.ok ? (r.json() as Promise<{ groups: ResolvedGroup[] }>) : { groups: [] }))
      .then((d) => {
        if (!alive) return;
        const m = new Map<string, ResolvedField>();
        for (const g of d.groups) for (const f of g.fields) m.set(f.id, f);
        setResolved(m);
      })
      .catch(() => {
        if (alive) setResolved(new Map());
      });
    return () => {
      alive = false;
    };
  }, [slug, photo.id]);

  const groups = useMemo(
    () =>
      (schema ?? [])
        .map((g) => ({ ...g, fields: g.fields.filter((f) => f.enabled) }))
        .filter((g) => g.fields.length > 0),
    [schema],
  );

  // Very first load (cache cold): show a brief skeleton so the panel doesn't pop in.
  if (schema === undefined) {
    return (
      <div className="space-y-1.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-40" />
          </div>
        ))}
      </div>
    );
  }

  if (groups.length === 0) return null;

  return (
    <MetadataFieldsList
      groups={groups}
      renderValue={(field) => {
        if (resolved === null) return <Skeleton className="h-7 w-40" />;
        const r = resolved.get(field.id);
        // In the cached schema but gone from fresh values (deleted in Settings) — skip.
        if (!r) return null;
        return <MetadataValueField slug={slug} photoId={photo.id} field={r} />;
      }}
    />
  );
}
