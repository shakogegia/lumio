/**
 * Canonical paths for the global (non-catalog-scoped) API routes.
 * Catalog-scoped routes go through catalogApiUrl() in lib/catalog-api.ts.
 * Per-catalog resource paths are also here as template helpers.
 */

export const apiPaths = {
  /** Global catalog list/create endpoint. */
  catalogs: "/api/catalogs",
  /** Per-catalog settings/rename/delete endpoint. */
  catalog: (id: string) => `/api/catalogs/${id}`,
  /** Global and per-catalog feature-flag toggle endpoint. */
  features: "/api/features",
  /** Current user profile settings. */
  profile: "/api/profile",
  settingsGeneral: "/api/settings/general",
} as const;
