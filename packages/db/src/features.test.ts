import { describe, expect, it, vi } from "vitest";
import { FeatureKey, FeatureScope, type FeatureDef } from "@lumio/shared";
import {
  resolveFeatures,
  setFeature,
  getGlobalFeatureStates,
  getCatalogFeatureStates,
  FeatureScopeError,
  assertScopeAllowed,
} from "./features.js";

type Row = { featureKey: string; catalogId: string | null; enabled: boolean };

function readDb(rows: Row[]) {
  return { featureSetting: { findMany: async () => rows } } as never;
}

describe("resolveFeatures", () => {
  it("uses the registry default when there are no rows", async () => {
    const map = await resolveFeatures("cat1", readDb([]));
    expect(map[FeatureKey.DiskExplorer]).toBe(false); // default
  });
  it("global ON, no catalog override => enabled (catalog inherits on)", async () => {
    const map = await resolveFeatures("cat1", readDb([
      { featureKey: "diskExplorer", catalogId: null, enabled: true },
    ]));
    expect(map[FeatureKey.DiskExplorer]).toBe(true);
  });
  it("global ON but this catalog opted out => disabled", async () => {
    const map = await resolveFeatures("cat1", readDb([
      { featureKey: "diskExplorer", catalogId: null, enabled: true },
      { featureKey: "diskExplorer", catalogId: "cat1", enabled: false },
    ]));
    expect(map[FeatureKey.DiskExplorer]).toBe(false);
  });
  it("global OFF overrides a catalog ON (master switch)", async () => {
    const map = await resolveFeatures("cat1", readDb([
      { featureKey: "diskExplorer", catalogId: null, enabled: false },
      { featureKey: "diskExplorer", catalogId: "cat1", enabled: true },
    ]));
    expect(map[FeatureKey.DiskExplorer]).toBe(false);
  });
});

describe("getGlobalFeatureStates / getCatalogFeatureStates", () => {
  it("global states fall back to default", async () => {
    const states = await getGlobalFeatureStates(readDb([]));
    expect(states.find((s) => s.key === FeatureKey.DiskExplorer)?.enabled).toBe(false);
  });
  it("catalog states report globalEnabled + inherit-on catalogEnabled", async () => {
    const states = await getCatalogFeatureStates("cat1", readDb([
      { featureKey: "diskExplorer", catalogId: null, enabled: true },
    ]));
    const d = states.find((s) => s.key === FeatureKey.DiskExplorer)!;
    expect(d.globalEnabled).toBe(true);
    expect(d.catalogEnabled).toBe(true); // no override => inherit on
  });
});

describe("setFeature", () => {
  it("writes via updateMany then create when no row exists", async () => {
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const create = vi.fn(async () => undefined);
    const db = {
      $transaction: async (fn: (tx: never) => Promise<void>) =>
        fn({ featureSetting: { updateMany, create } } as never),
    } as never;
    await setFeature({ key: FeatureKey.DiskExplorer, catalogId: null, enabled: true }, db);
    expect(updateMany).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce(); // count 0 => create
  });
  it("FeatureScopeError is exported", () => {
    expect(new FeatureScopeError("x")).toBeInstanceOf(Error);
  });
});

describe("assertScopeAllowed", () => {
  const globalOnly: FeatureDef = {
    key: FeatureKey.DiskExplorer,
    label: "x",
    description: "x",
    scopes: [FeatureScope.Global],
    default: false,
  };
  it("returns the scope when the feature declares it", () => {
    expect(assertScopeAllowed(globalOnly, null)).toBe(FeatureScope.Global);
  });
  it("throws FeatureScopeError for an undeclared scope (catalog override on a global-only feature)", () => {
    expect(() => assertScopeAllowed(globalOnly, "cat1")).toThrow(FeatureScopeError);
  });
});
