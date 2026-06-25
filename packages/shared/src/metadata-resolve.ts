import type { ExifData } from "./types.js";
import { FieldType, FieldKind, MetadataValueSource } from "./enums.js";
import { resolveStandardFields, StandardFieldKey } from "./metadata-standard.js";

/** One field's per-catalog definition (what the DB's getCatalogSchema returns). */
export interface MetadataFieldDef {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  kind: FieldKind;
  /** StandardFieldKey when kind === Standard; null for custom fields. */
  builtinKey: StandardFieldKey | null;
  enabled: boolean;
  suggests: boolean;
}

export interface MetadataSchemaGroup {
  id: string;
  label: string;
  fields: MetadataFieldDef[];
}

export type MetadataSchema = MetadataSchemaGroup[];

/** A field resolved to a concrete display value for one photo. */
export interface ResolvedField {
  id: string;
  key: string;
  label: string;
  type: FieldType;
  kind: FieldKind;
  suggests: boolean;
  value: string | null;
  source: MetadataValueSource;
}

export interface ResolvedGroup {
  id: string;
  label: string;
  fields: ResolvedField[];
}

/**
 * Merge a catalog's metadata schema with a photo's stored values and its EXIF
 * into a grouped, display-ready model. Disabled fields are dropped. Standard
 * fields fall back to EXIF (via the 1a registry) unless a stored value overrides
 * them; custom fields use stored values only.
 *
 * @param values Map of fieldId → stored string value (custom values + standard overrides).
 */
export function resolvePhotoMetadata(
  schema: MetadataSchema,
  values: Map<string, string>,
  exif: ExifData,
): ResolvedGroup[] {
  const std = resolveStandardFields(exif);
  return schema.map((group) => ({
    id: group.id,
    label: group.label,
    fields: group.fields
      .filter((f) => f.enabled)
      .map((f) => {
        const stored = values.get(f.id) ?? null;
        const exifVal =
          f.kind === FieldKind.Standard && f.builtinKey ? std[f.builtinKey] : null;
        const value = stored ?? exifVal;
        const source =
          stored !== null
            ? MetadataValueSource.User
            : value !== null
              ? MetadataValueSource.Exif
              : MetadataValueSource.Empty;
        return {
          id: f.id,
          key: f.key,
          label: f.label,
          type: f.type,
          kind: f.kind,
          suggests: f.suggests,
          value,
          source,
        };
      }),
  }));
}
