import type { AlbumSummaryDTO } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";

/** One selectable value within a facet (album: value=id, label=name). */
export interface FacetOption {
  value: string;
  label: string;
}

/** A taggable dimension. Add a new facet by adding one of these to FACETS. */
export interface SearchFacet {
  /** Filter discriminator, also used as the chip's data-facet. */
  key: string;
  /** Human label shown in the menu group and chip prefix. */
  label: string;
  /** Fetch the selectable options for this facet (scoped to the active catalog). */
  loadOptions: (slug: string) => Promise<FacetOption[]>;
}

/** Flattened option as fed to TributeJS — carries its facet identity. */
export interface TributeFacetItem {
  facetKey: string;
  facetLabel: string;
  value: string;
  label: string;
}

const albumFacet: SearchFacet = {
  key: "album",
  label: "Album",
  loadOptions: async (slug) => {
    const res = await fetch(catalogApiUrl(slug, "/albums"));
    if (!res.ok) throw new Error(`Failed to load albums: ${res.status}`);
    const data: { items: AlbumSummaryDTO[] } = await res.json();
    return data.items
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ value: a.id, label: a.name }));
  },
};

/** The registry. Future facets (camera, date, …) are added here. */
export const FACETS: SearchFacet[] = [albumFacet];

/** Per-slug option cache so switching catalogs doesn't reuse another's albums. */
const cache = new Map<string, Promise<TributeFacetItem[]>>();

/**
 * Load every facet's options for the given catalog as one flat list for the
 * Tribute menu. Cached per slug for the lifetime of the page (new albums show
 * after a reload — acceptable for now).
 */
export function loadAllOptions(slug: string): Promise<TributeFacetItem[]> {
  let cached = cache.get(slug);
  if (!cached) {
    cached = Promise.all(
      FACETS.map((facet) =>
        facet.loadOptions(slug).then((opts) =>
          opts.map((o) => ({
            facetKey: facet.key,
            facetLabel: facet.label,
            value: o.value,
            label: o.label,
          })),
        ),
      ),
    )
      .then((groups) => groups.flat())
      .catch((err) => {
        cache.delete(slug); // don't memoize a failure — allow retry on the next trigger
        throw err;
      });
    cache.set(slug, cached);
  }
  return cached;
}
