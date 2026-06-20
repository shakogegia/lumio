import { describe, expect, it } from "vitest";
import { monthRange } from "./calendar.js";

describe("monthRange", () => {
  it("returns the UTC [gte, lt) bounds for a mid-year month", () => {
    const { gte, lt } = monthRange("2026-06");
    expect(gte.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("rolls December into the next January", () => {
    const { gte, lt } = monthRange("2026-12");
    expect(gte.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("ends February on March 1 (leap year)", () => {
    const { gte, lt } = monthRange("2024-02");
    expect(gte.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });
});
