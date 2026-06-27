"use client";

import type { FilterRule } from "@lumio/shared";
import { FacetMultiselect } from "./facet-multiselect";

/** Always-on "File type" facet. Reuses FacetMultiselect, which emits/reads
 *  `in_list` rules on the `extension` system field — no new rule plumbing. */
export function FileTypeFacet({
  extensions,
  rules,
  onRules,
}: {
  extensions: string[];
  rules: FilterRule[];
  onRules: (next: FilterRule[]) => void;
}) {
  if (extensions.length === 0) return null;
  return (
    <FacetMultiselect
      label="File type"
      fieldKey="extension"
      staticOptions={extensions}
      rules={rules}
      onRules={onRules}
    />
  );
}
