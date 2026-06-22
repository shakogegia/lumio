"use client";

import { createContext, useContext } from "react";
import type { FeatureKey, FeatureMap } from "@lumio/shared";

const FeaturesContext = createContext<FeatureMap | null>(null);

/**
 * Holds the effective feature map for the active catalog. SSR-seeded by the
 * catalog layout (no client fetch) — the map is recomputed server-side on every
 * catalog-layout render, so a settings toggle + router.refresh() is reflected on
 * the next navigation. The only client consumer is the sidebar.
 */
export function FeaturesProvider({
  value,
  children,
}: {
  value: FeatureMap;
  children: React.ReactNode;
}) {
  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>;
}

/** Effective enabled-state for one feature in the active catalog. */
export function useFeature(key: FeatureKey): boolean {
  const ctx = useContext(FeaturesContext);
  return ctx ? ctx[key] : false;
}
