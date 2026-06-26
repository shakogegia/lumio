"use client";

import { useEffect, useState } from "react";
import type { MetadataSchema } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";

// Module-level cache so a catalog's metadata schema (the field *structure*) is
// fetched once per session and reused instantly when opening photos — only the
// per-photo *values* load async after that. Survives across lightbox mounts.
const cache = new Map<string, MetadataSchema>();
const inflight = new Map<string, Promise<MetadataSchema>>();

function fetchSchema(slug: string): Promise<MetadataSchema> {
  const existing = inflight.get(slug);
  if (existing) return existing;
  const p = fetch(catalogApiUrl(slug, "/metadata/schema"))
    .then((r) => (r.ok ? (r.json() as Promise<{ schema: MetadataSchema }>) : { schema: [] }))
    .then((d) => {
      cache.set(slug, d.schema);
      return d.schema;
    })
    .catch(() => {
      const empty: MetadataSchema = [];
      cache.set(slug, empty);
      return empty;
    })
    .finally(() => inflight.delete(slug));
  inflight.set(slug, p);
  return p;
}

/** Drop the cached schema for a catalog (call after editing it in Settings). */
export function invalidateMetadataSchema(slug: string): void {
  cache.delete(slug);
  inflight.delete(slug);
}

/**
 * Pre-fill the cache from a server-rendered schema so the FIRST client read is
 * instant — no `/metadata/schema` round-trip on dialog/panel open. Seeded once
 * per catalog load by MetadataSchemaProvider; an in-flight fetch (rare) wins so
 * we never clobber a fresher value mid-flight.
 */
export function seedMetadataSchema(slug: string, schema: MetadataSchema): void {
  if (inflight.has(slug)) return;
  cache.set(slug, schema);
}

/**
 * The catalog's metadata schema, served from cache when available (so the Info
 * tab can render field structure immediately). `undefined` only on the very
 * first load before the cache is warm.
 */
export function useCatalogMetadataSchema(slug: string): MetadataSchema | undefined {
  const [schema, setSchema] = useState<MetadataSchema | undefined>(() => cache.get(slug));
  // Re-sync to the new catalog's cached schema when the slug changes (instant
  // when warm). Render-time adjust — not an effect — so no cascading-render.
  const [prevSlug, setPrevSlug] = useState(slug);
  if (slug !== prevSlug) {
    setPrevSlug(slug);
    setSchema(cache.get(slug));
  }
  useEffect(() => {
    if (cache.has(slug)) return; // warm: seeded server-side or already fetched
    let alive = true;
    void fetchSchema(slug).then((s) => {
      if (alive) setSchema(s);
    });
    return () => {
      alive = false;
    };
  }, [slug]);
  return schema;
}
