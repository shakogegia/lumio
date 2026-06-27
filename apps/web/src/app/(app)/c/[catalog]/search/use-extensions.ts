"use client";

import { useEffect, useState } from "react";
import { catalogApiUrl } from "@/lib/catalog-api";

/** Distinct file extensions present in the catalog (sorted, lowercased, no dot).
 *  Empty while loading or when the catalog has none. */
export function useExtensions(slug: string): string[] {
  const [extensions, setExtensions] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    fetch(catalogApiUrl(slug, "/extensions"))
      .then((r) => (r.ok ? (r.json() as Promise<{ extensions: string[] }>) : { extensions: [] }))
      .then((d) => {
        if (active) setExtensions(d.extensions ?? []);
      })
      .catch(() => {
        if (active) setExtensions([]);
      });
    return () => {
      active = false;
    };
  }, [slug]);
  return extensions;
}
