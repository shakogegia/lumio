/**
 * Feature registry — the single source of truth for which optional features
 * exist, the scope(s) they can be toggled at, and their GLOBAL default.
 * Pure: no Prisma, no Next, no Node. Both server and client import it.
 *
 * Resolution rule (implemented in @lumio/db/features.ts):
 *   global  = the global row's value, else `default`
 *   catalog = the per-catalog row's value, else `true` (inherit / opt-out only)
 *   effective = global && (scopes includes catalog ? catalog : true)
 */

import { z } from "zod";

export enum FeatureKey {
  DiskExplorer = "diskExplorer",
  Metadata = "metadata",
  StandardMetadata = "standardMetadata",
}

export enum FeatureScope {
  Global = "global",
  Catalog = "catalog",
}

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  description: string;
  scopes: FeatureScope[];
  /** The GLOBAL default when no global row exists. */
  default: boolean;
}

export const FEATURES: Record<FeatureKey, FeatureDef> = {
  [FeatureKey.DiskExplorer]: {
    key: FeatureKey.DiskExplorer,
    label: "Folder browser",
    description: "Browse the catalog's folders and files on disk.",
    scopes: [FeatureScope.Global, FeatureScope.Catalog],
    default: false,
  },
  [FeatureKey.Metadata]: {
    key: FeatureKey.Metadata,
    label: "Photo metadata",
    description: "Custom fields, presets, and per-catalog metadata on photos.",
    scopes: [FeatureScope.Global, FeatureScope.Catalog],
    default: false,
  },
  [FeatureKey.StandardMetadata]: {
    key: FeatureKey.StandardMetadata,
    label: "Standard metadata",
    description: "Show camera, lens, and exposure (from EXIF) on photos.",
    scopes: [FeatureScope.Catalog],
    default: true,
  },
};

/** Effective enabled-state for every feature, keyed by FeatureKey. */
export type FeatureMap = Record<FeatureKey, boolean>;

/** All feature keys, in registry order. */
export const ALL_FEATURE_KEYS = Object.values(FeatureKey);

/** Body for PUT /api/features — toggle one feature. */
export const featureToggleSchema = z.object({
  key: z.nativeEnum(FeatureKey),
  catalogId: z.string().min(1).nullable(),
  enabled: z.boolean(),
});
export type FeatureToggleInput = z.infer<typeof featureToggleSchema>;
