import { describe, expect, it } from "vitest";
import { FEATURES, FeatureKey, FeatureScope } from "./features.js";

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
