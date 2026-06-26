import {
  DEFAULT_PHOTO_SORT,
  FieldType,
  type MetadataSchema,
  parseMetadataSort,
  type PhotoSort,
} from "@lumio/shared";

export interface DateSortField {
  id: string;
  label: string;
}

/** Enabled Date custom fields for a catalog, flattened from the schema groups,
 *  in schema order — the sortable date fields offered in the grid sort menu. */
export function dateSortFields(schema: MetadataSchema): DateSortField[] {
  return schema
    .flatMap((g) => g.fields)
    .filter((f) => f.enabled && f.type === FieldType.Date)
    .map((f) => ({ id: f.id, label: f.label }));
}

/** Resolve a stored sort against this catalog's date fields. A metadata sort
 *  whose field is not present (different catalog / deleted) falls back to the
 *  default so the menu selection and the grid order stay consistent. `fields`
 *  undefined = schema not loaded yet → keep the stored sort untouched. */
export function effectiveGridSort(
  sort: PhotoSort,
  fields: DateSortField[] | undefined,
): PhotoSort {
  const meta = parseMetadataSort(sort);
  if (!meta || !fields) return sort;
  return fields.some((f) => f.id === meta.fieldId) ? sort : DEFAULT_PHOTO_SORT;
}
