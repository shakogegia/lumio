// apps/web/src/features/lightbox/metadata-panel.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import type { PhotoDTO, ResolvedField, ResolvedGroup } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { Skeleton } from "@/components/ui/skeleton";
import { useCatalogMetadataSchema } from "./use-metadata-schema";
import { MetadataFieldRow } from "./metadata-field-row";

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
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.id} className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </p>
          {group.fields.map((field) => {
            if (resolved === null) {
              // Structure known, values still loading.
              return (
                <div key={field.id} className="flex items-center justify-between gap-3">
                  <span className="shrink-0 text-muted-foreground">{field.label}</span>
                  <Skeleton className="h-7 w-40" />
                </div>
              );
            }
            const r = resolved.get(field.id);
            // Field present in the cached schema but not in the fresh values
            // (e.g. just deleted in Settings) — skip it.
            if (!r) return null;
            return <MetadataFieldRow key={field.id} slug={slug} photoId={photo.id} field={r} />;
          })}
        </div>
      ))}
    </div>
  );
}
