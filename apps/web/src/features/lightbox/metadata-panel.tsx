// apps/web/src/features/lightbox/metadata-panel.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import type { PhotoDTO, ResolvedGroup } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { MetadataFieldRow } from "./metadata-field-row";

export function MetadataPanel({ photo }: { photo: PhotoDTO }) {
  const { slug } = useCatalog();
  const [groups, setGroups] = useState<ResolvedGroup[] | null>(null);
  const [hasSchema, setHasSchema] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(catalogApiUrl(slug, `/metadata/photo/${photo.id}`));
    if (!r.ok) {
      setHasSchema(false);
      setGroups([]);
      return;
    }
    const data = (await r.json()) as { groups: ResolvedGroup[] };
    setGroups(data.groups);
    setHasSchema(data.groups.length > 0);
  }, [slug, photo.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyPreset(presetId: string) {
    setBusy(true);
    try {
      await fetch(catalogApiUrl(slug, "/metadata/apply-preset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (hasSchema === null) return null; // first load

  if (!hasSchema) {
    return (
      <div className="space-y-2">
        <p className="font-medium">Metadata</p>
        <p className="text-xs text-muted-foreground">
          Start from a preset — you can edit the fields afterwards.
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy} onClick={() => applyPreset("film")}>
            Film
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => applyPreset("digital")}>
            Digital
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {(groups ?? [])
        .filter((g) => g.fields.length > 0)
        .map((group) => (
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
