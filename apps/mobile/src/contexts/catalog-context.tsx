import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import * as SecureStore from "expo-secure-store";
import { useAuth } from "./auth-context";
import { fetchCatalogs, type Catalog } from "@/lib/catalog-api";

// Remembers the chosen catalog across launches.
const ACTIVE_KEY = "lumio.activeCatalog";

type CatalogContextValue = {
  catalogs: Catalog[];
  activeCatalog: Catalog | null;
  activeCatalogId: string | null;
  setActiveCatalog: (id: string) => void;
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
};

const CatalogContext = createContext<CatalogContextValue | null>(null);

/** Loads the signed-in user's catalogs from the server and tracks the active one
 *  (persisted). Mount inside the authed area so a session/cookie exists. */
export function CatalogProvider({ children }: { children: ReactNode }) {
  const { serverUrl, session, getCookie } = useAuth();
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [activeCatalogId, setActiveCatalogId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // setState only happens inside the deferred promise callbacks (never
  // synchronously), so this is safe to call from the effect — the React Compiler
  // lint forbids synchronous setState there.
  const load = useCallback(() => {
    if (!serverUrl || !session) return;
    Promise.all([fetchCatalogs(serverUrl, getCookie()), SecureStore.getItemAsync(ACTIVE_KEY)])
      .then(([list, stored]) => {
        setCatalogs(list);
        // Keep the current/stored choice if it still exists, else use the first.
        setActiveCatalogId((prev) => {
          const candidate = prev ?? stored;
          return list.find((c) => c.id === candidate)?.id ?? list[0]?.id ?? null;
        });
        setError(null);
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Could not load catalogs."),
      )
      .finally(() => setIsLoading(false));
  }, [serverUrl, session, getCookie]);

  useEffect(() => {
    load();
  }, [load]);

  const setActiveCatalog = useCallback((id: string) => {
    setActiveCatalogId(id);
    void SecureStore.setItemAsync(ACTIVE_KEY, id);
  }, []);

  const value = useMemo<CatalogContextValue>(
    () => ({
      catalogs,
      activeCatalog: catalogs.find((c) => c.id === activeCatalogId) ?? null,
      activeCatalogId,
      setActiveCatalog,
      isLoading,
      error,
      refetch: load,
    }),
    [catalogs, activeCatalogId, setActiveCatalog, isLoading, error, load],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalogs(): CatalogContextValue {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalogs must be used within CatalogProvider");
  return ctx;
}
