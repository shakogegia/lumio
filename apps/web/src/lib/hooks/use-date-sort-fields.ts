"use client";

import { FeatureKey } from "@lumio/shared";
import { useFeature } from "@/components/features/features-provider";
import { useCatalog } from "@/components/providers/catalog-context";
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import { dateSortFields, type DateSortField } from "@/lib/grid-sort";

/**
 * Enabled Date custom fields for the current catalog's grid sort menu, gated by
 * the Metadata feature. Returns `undefined` while the schema is still loading
 * (so a stored metadata sort isn't dropped prematurely), and `[]` when the
 * Metadata feature is off or no Date fields are configured.
 */
export function useDateSortFields(): DateSortField[] | undefined {
  const metadataEnabled = useFeature(FeatureKey.Metadata);
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);
  if (!metadataEnabled) return [];
  return schema ? dateSortFields(schema) : undefined;
}
