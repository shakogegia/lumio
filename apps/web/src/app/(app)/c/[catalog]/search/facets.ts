import type { AlbumSummaryDTO } from "@lumio/shared";

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
  /** Fetch the selectable options for this facet. */
  loadOptions: () => Promise<FacetOption[]>;
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
  loadOptions: async () => {
    const res = await fetch("/api/albums");
    if (!res.ok) throw new Error(`Failed to load albums: ${res.status}`);
    const data: { items: AlbumSummaryDTO[] } = await res.json();
    return data.items.map((a) => ({ value: a.id, label: a.name }));
  },
};

/** The registry. Future facets (camera, date, …) are added here. */
export const FACETS: SearchFacet[] = [albumFacet];

let cache: Promise<TributeFacetItem[]> | null = null;

/**
 * Load every facet's options as one flat list for the Tribute menu. Cached for
 * the lifetime of the page (new albums show after a reload — acceptable for now).
 */
export function loadAllOptions(): Promise<TributeFacetItem[]> {
  if (!cache) {
    cache = Promise.all(
      FACETS.map((facet) =>
        facet.loadOptions().then((opts) =>
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
        cache = null; // don't memoize a failure — allow retry on the next trigger
        throw err;
      });
  }
  return cache;
}
