"use client";
import { createContext, useContext } from "react";

export interface ActiveCatalog { id: string; slug: string; name: string; }
const CatalogContext = createContext<ActiveCatalog | null>(null);

export function CatalogProvider({ catalog, children }: { catalog: ActiveCatalog; children: React.ReactNode }) {
  return <CatalogContext.Provider value={catalog}>{children}</CatalogContext.Provider>;
}
export function useCatalog(): ActiveCatalog {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog must be used within a CatalogProvider");
  return ctx;
}
