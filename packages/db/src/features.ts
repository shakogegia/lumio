import type { PrismaClient } from "@prisma/client";
import {
  ALL_FEATURE_KEYS,
  FEATURES,
  FeatureKey,
  FeatureScope,
  type FeatureMap,
} from "@lumio/shared";
import { prisma } from "./client.js";

type FeaturesReadDb = Pick<PrismaClient, "featureSetting">;
type FeaturesWriteDb = Pick<PrismaClient, "$transaction">;

export class UnknownFeatureError extends Error {}
export class FeatureScopeError extends Error {}

interface ScopeRows {
  global: Map<string, boolean>;
  catalog: Map<string, boolean>;
}

async function loadRows(catalogId: string, db: FeaturesReadDb): Promise<ScopeRows> {
  const rows = await db.featureSetting.findMany({
    where: { OR: [{ catalogId: null }, { catalogId }] },
  });
  const global = new Map<string, boolean>();
  const catalog = new Map<string, boolean>();
  for (const r of rows) {
    if (r.catalogId === null) global.set(r.featureKey, r.enabled);
    else catalog.set(r.featureKey, r.enabled);
  }
  return { global, catalog };
}

function globalOf(key: FeatureKey, rows: { global: Map<string, boolean> }): boolean {
  return rows.global.get(key) ?? FEATURES[key].default;
}

function catalogOf(key: FeatureKey, rows: { catalog: Map<string, boolean> }): boolean {
  // Catalog scope inherits ON; a row only ever opts a catalog OUT.
  return rows.catalog.get(key) ?? true;
}

/** Effective enabled-state for every feature, for one catalog. */
export async function resolveFeatures(
  catalogId: string,
  db: FeaturesReadDb = prisma,
): Promise<FeatureMap> {
  const rows = await loadRows(catalogId, db);
  const map = {} as FeatureMap;
  for (const key of ALL_FEATURE_KEYS) {
    const usesCatalog = FEATURES[key].scopes.includes(FeatureScope.Catalog);
    map[key] = globalOf(key, rows) && (usesCatalog ? catalogOf(key, rows) : true);
  }
  return map;
}

/** Convenience for route/page guards. */
export async function isFeatureEnabled(
  catalogId: string,
  key: FeatureKey,
  db: FeaturesReadDb = prisma,
): Promise<boolean> {
  return (await resolveFeatures(catalogId, db))[key];
}

export interface GlobalFeatureState {
  key: FeatureKey;
  label: string;
  description: string;
  enabled: boolean;
}

/** Raw global switch state for every feature (for the global Features settings page). */
export async function getGlobalFeatureStates(
  db: FeaturesReadDb = prisma,
): Promise<GlobalFeatureState[]> {
  const rows = await db.featureSetting.findMany({ where: { catalogId: null } });
  const byKey = new Map(rows.map((r) => [r.featureKey, r.enabled]));
  return ALL_FEATURE_KEYS.map((key) => ({
    key,
    label: FEATURES[key].label,
    description: FEATURES[key].description,
    enabled: byKey.get(key) ?? FEATURES[key].default,
  }));
}

export interface CatalogFeatureState {
  key: FeatureKey;
  label: string;
  description: string;
  globalEnabled: boolean;
  catalogEnabled: boolean;
}

/** Per-catalog state for catalog-scoped features (for the catalog Features tab). */
export async function getCatalogFeatureStates(
  catalogId: string,
  db: FeaturesReadDb = prisma,
): Promise<CatalogFeatureState[]> {
  const rows = await loadRows(catalogId, db);
  return ALL_FEATURE_KEYS.filter((key) =>
    FEATURES[key].scopes.includes(FeatureScope.Catalog),
  ).map((key) => ({
    key,
    label: FEATURES[key].label,
    description: FEATURES[key].description,
    globalEnabled: globalOf(key, rows),
    catalogEnabled: catalogOf(key, rows),
  }));
}

/**
 * Upsert one toggle. `catalogId === null` writes the global switch; a non-null
 * id writes a per-catalog override. We use updateMany+create inside a
 * transaction (not upsert) because Postgres treats a NULL catalogId as distinct
 * in the unique index, so upsert-by-unique cannot dedupe global rows.
 */
export async function setFeature(
  input: { key: FeatureKey; catalogId: string | null; enabled: boolean },
  db: FeaturesWriteDb = prisma,
): Promise<void> {
  const def = FEATURES[input.key];
  if (!def) throw new UnknownFeatureError(String(input.key));
  const scope = input.catalogId === null ? FeatureScope.Global : FeatureScope.Catalog;
  if (!def.scopes.includes(scope)) {
    throw new FeatureScopeError(`${input.key} cannot be toggled at scope ${scope}`);
  }
  await db.$transaction(async (tx) => {
    const updated = await tx.featureSetting.updateMany({
      where: { featureKey: input.key, catalogId: input.catalogId },
      data: { enabled: input.enabled },
    });
    if (updated.count === 0) {
      await tx.featureSetting.create({
        data: { featureKey: input.key, catalogId: input.catalogId, enabled: input.enabled },
      });
    }
  });
}
