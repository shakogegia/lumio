"use client";

import { useState } from "react";
import type { MetadataSchema } from "@lumio/shared";
import { seedMetadataSchema } from "@/features/lightbox/use-metadata-schema";

/**
 * Seeds the metadata-schema cache from the server when the catalog loads, so
 * every consumer — the lightbox Info tab, the search filter panel, the
 * smart-album rule builder, the upload editor — reads the schema instantly with
 * no client fetch. `useState` runs the seed once, synchronously during the first
 * render (before descendants mount), so their `useCatalogMetadataSchema()`
 * initializers find a warm cache. Edits still invalidate + refetch as before.
 */
export function MetadataSchemaProvider({
  slug,
  schema,
  children,
}: {
  slug: string;
  schema: MetadataSchema;
  children: React.ReactNode;
}) {
  useState(() => {
    seedMetadataSchema(slug, schema);
    return null;
  });
  return children;
}
