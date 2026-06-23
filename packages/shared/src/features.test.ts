import { describe, expect, it } from "vitest";
import { FEATURES, FeatureKey, FeatureScope, featureToggleSchema } from "./features.js";

describe("FEATURES registry", () => {
  it("has an entry for every FeatureKey, keyed by its own key", () => {
    for (const key of Object.values(FeatureKey)) {
      const def = FEATURES[key];
      expect(def, `missing entry for ${key}`).toBeTruthy();
      expect(def.key).toBe(key);
    }
  });
  it("every feature declares at least one scope", () => {
    for (const def of Object.values(FEATURES)) {
      expect(def.scopes.length).toBeGreaterThan(0);
      for (const s of def.scopes) {
        expect(Object.values(FeatureScope)).toContain(s);
      }
    }
  });
  it("disk explorer is global+catalog and defaults off", () => {
    const d = FEATURES[FeatureKey.DiskExplorer];
    expect(d.scopes).toEqual([FeatureScope.Global, FeatureScope.Catalog]);
    expect(d.default).toBe(false);
  });
});

describe("featureToggleSchema", () => {
  it("accepts a valid toggle with catalogId string", () => {
    const result = featureToggleSchema.parse({ key: FeatureKey.DiskExplorer, catalogId: "cat-1", enabled: true });
    expect(result).toEqual({ key: FeatureKey.DiskExplorer, catalogId: "cat-1", enabled: true });
  });
  it("accepts a valid toggle with catalogId null (global scope)", () => {
    const result = featureToggleSchema.parse({ key: FeatureKey.DiskExplorer, catalogId: null, enabled: false });
    expect(result.catalogId).toBeNull();
  });
  it("rejects an unknown feature key", () => {
    expect(() => featureToggleSchema.parse({ key: "unknown", catalogId: null, enabled: true })).toThrow();
  });
  it("rejects enabled as a non-boolean", () => {
    expect(() => featureToggleSchema.parse({ key: FeatureKey.DiskExplorer, catalogId: null, enabled: 1 })).toThrow();
  });
});
