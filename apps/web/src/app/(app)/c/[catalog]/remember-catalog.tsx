"use client";
// Must match LAST_CATALOG_COOKIE in @/lib/server/active-catalog (server-only module
// can't be imported here). Keep these two values in sync.
const LAST_CATALOG_COOKIE = "lumio.lastCatalog";

import { useEffect } from "react";

export function RememberCatalog({ slug }: { slug: string }) {
  useEffect(() => {
    document.cookie = `${LAST_CATALOG_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax`;
  }, [slug]);
  return null;
}
