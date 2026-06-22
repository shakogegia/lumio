"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";

/**
 * The on-disk size/count figures are memoized server-side (so navigating to
 * Settings doesn't re-walk the directories every time). This busts that memo and
 * re-renders, forcing a fresh walk — use it after an ingest, cache clear, etc.
 */
export function RefreshStatsButton() {
  const router = useRouter();
  const { slug } = useCatalog();
  const [busy, setBusy] = useState(false);

  async function recalculate() {
    setBusy(true);
    try {
      await fetch(catalogApiUrl(slug, "/storage/refresh"), { method: "POST" });
    } catch {
      // best-effort — re-render anyway so the user isn't stuck on a spinner
    } finally {
      router.refresh();
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" size="sm" onClick={recalculate} disabled={busy}>
      <RefreshCw className={busy ? "animate-spin" : undefined} />
      Recalculate sizes
    </Button>
  );
}
