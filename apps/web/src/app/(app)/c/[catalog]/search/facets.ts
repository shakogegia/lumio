import type { AlbumSummaryDTO, FilterRule, MetadataSchema } from "@lumio/shared";
import { FieldType, RuleOp } from "@lumio/shared";
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

/** Flattened option as fed to TributeJS — carries its facet identity.
 *  `rule` present → picking it inserts a metadata filter chip (e.g. a custom
 *  field value); absent → an album chip. */
export interface TributeFacetItem {
  facetKey: string;
  facetLabel: string;
  value: string;
  label: string;
  rule?: FilterRule;
}

/**
 * Metadata `@` options: every choice field's options (so you can pick a value
 * even before any photo uses it) + existing values for text fields (incl. the
 * standard camera/lens overrides) via the suggest endpoint. Choice → `in_list`,
 * text → `contains`. Numeric/date fields are filtered via the panel, not `@`.
 */
async function loadMetadataOptions(slug: string): Promise<TributeFacetItem[]> {
  const res = await fetch(catalogApiUrl(slug, "/metadata/schema")).catch(() => null);
  if (!res || !res.ok) return [];
  const { schema } = (await res.json()) as { schema: MetadataSchema };
  const fields = schema.flatMap((g) => g.fields).filter((f) => f.enabled);

  const items: TributeFacetItem[] = [];
  for (const f of fields) {
    if (f.type === FieldType.Choice) {
      for (const opt of f.options) {
        items.push({
          facetKey: f.key, facetLabel: f.label, value: opt, label: opt,
          rule: { field: f.key, op: RuleOp.in_list, value: [opt] },
        });
      }
    }
  }
  const textFields = fields.filter((f) => f.type === FieldType.Text || f.type === FieldType.Textarea);
  const lists = await Promise.all(
    textFields.map((f) =>
      fetch(catalogApiUrl(slug, `/metadata/suggest?field=${encodeURIComponent(f.id)}`))
        .then((r) => (r.ok ? (r.json() as Promise<{ values: string[] }>) : { values: [] }))
        .then((d) => ({ f, values: d.values ?? [] }))
        .catch(() => ({ f, values: [] as string[] })),
    ),
  );
  for (const { f, values } of lists) {
    for (const v of values) {
      items.push({
        facetKey: f.key, facetLabel: f.label, value: v, label: v,
        rule: { field: f.key, op: RuleOp.contains, value: v },
      });
    }
  }
  return items;
}

/**
 * File-type `@` options: every distinct extension present in the catalog, each
 * inserting an `extension in_list` chip. The `@`-picker mirror of the panel's
 * File-type facet. Always available (extension is a built-in system field), even
 * when the catalog has no metadata schema.
 */
async function loadExtensionOptions(slug: string): Promise<TributeFacetItem[]> {
  const res = await fetch(catalogApiUrl(slug, "/extensions")).catch(() => null);
  if (!res || !res.ok) return [];
  const { extensions } = (await res.json()) as { extensions: string[] };
  return (extensions ?? []).map((ext) => ({
    facetKey: "extension",
    facetLabel: "File type",
    value: ext,
    label: ext,
    rule: { field: "extension", op: RuleOp.in_list, value: [ext] },
  }));
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
    cached = Promise.all([
      ...FACETS.map((facet) =>
        facet.loadOptions(slug).then((opts) =>
          opts.map((o) => ({
            facetKey: facet.key,
            facetLabel: facet.label,
            value: o.value,
            label: o.label,
          })),
        ),
      ),
      loadMetadataOptions(slug),
      loadExtensionOptions(slug),
    ])
      .then((groups) => groups.flat())
      .catch((err) => {
        cache.delete(slug); // don't memoize a failure — allow retry on the next trigger
        throw err;
      });
    cache.set(slug, cached);
  }
  return cached;
}
