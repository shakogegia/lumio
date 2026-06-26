"use client";
import { useEffect, useState } from "react";
import { catalogApiUrl } from "@/lib/catalog-api";

/** Distinct prior values for a custom field (autocomplete). Empty until loaded. */
export function useMetadataValues(slug: string, fieldId: string | null, query: string): string[] {
  const [values, setValues] = useState<string[]>([]);
  useEffect(() => {
    if (!fieldId) return;
    let alive = true;
    const q = query.trim();
    fetch(catalogApiUrl(slug, `/metadata/suggest?field=${encodeURIComponent(fieldId)}${q ? `&q=${encodeURIComponent(q)}` : ""}`))
      .then((r) => (r.ok ? (r.json() as Promise<{ values: string[] }>) : { values: [] }))
      .then((d) => { if (alive) setValues(d.values ?? []); })
      .catch(() => { if (alive) setValues([]); });
    return () => { alive = false; };
  }, [slug, fieldId, query]);
  return values;
}
