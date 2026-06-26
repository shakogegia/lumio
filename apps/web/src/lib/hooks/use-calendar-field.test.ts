import { describe, expect, it } from "vitest";
import { effectiveCalendarField, parseCalendarFieldStored } from "./use-calendar-field";

describe("parseCalendarFieldStored", () => {
  it("coerces stored values, defaulting on junk", () => {
    expect(parseCalendarFieldStored("imported")).toBe("imported");
    expect(parseCalendarFieldStored("meta:clx1")).toBe("meta:clx1");
    expect(parseCalendarFieldStored(null)).toBe("taken");
  });
});

describe("effectiveCalendarField", () => {
  const fields = [{ id: "clx1", label: "Shoot" }];
  it("keeps a standard field", () => {
    expect(effectiveCalendarField("imported", fields)).toBe("imported");
  });
  it("keeps a present metadata field", () => {
    expect(effectiveCalendarField("meta:clx1", fields)).toBe("meta:clx1");
  });
  it("falls back when the metadata field is absent", () => {
    expect(effectiveCalendarField("meta:gone", fields)).toBe("taken");
  });
  it("leaves the field untouched while fields load (undefined)", () => {
    expect(effectiveCalendarField("meta:gone", undefined)).toBe("meta:gone");
  });
});
