import { describe, expect, it } from "vitest";
import {
  CALENDAR_FIELDS,
  calendarColumn,
  coerceCalendarField,
  DEFAULT_CALENDAR_FIELD,
  isCalendarField,
  monthRange,
  monthStringRange,
  parseCalendarMetaField,
} from "./calendar.js";

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

describe("CalendarField", () => {
  it("maps standard fields to Photo columns", () => {
    expect(calendarColumn("taken")).toBe("sortDate");
    expect(calendarColumn("imported")).toBe("createdAt");
    expect(calendarColumn("created")).toBe("fileCreatedAt");
  });
  it("parses metadata field tokens", () => {
    expect(parseCalendarMetaField("meta:clx1")).toBe("clx1");
    expect(parseCalendarMetaField("taken")).toBeNull();
    expect(parseCalendarMetaField("meta:")).toBeNull();
  });
  it("validates with isCalendarField", () => {
    expect(isCalendarField("taken")).toBe(true);
    expect(isCalendarField("meta:clx1")).toBe(true);
    expect(isCalendarField("meta:clx1:asc")).toBe(false);
    expect(isCalendarField("nope")).toBe(false);
    expect(isCalendarField(7)).toBe(false);
  });
  it("coerces unknown input to the default", () => {
    expect(coerceCalendarField("imported")).toBe("imported");
    expect(coerceCalendarField("meta:clx1")).toBe("meta:clx1");
    expect(coerceCalendarField("junk")).toBe(DEFAULT_CALENDAR_FIELD);
    expect(coerceCalendarField(null)).toBe(DEFAULT_CALENDAR_FIELD);
    expect(DEFAULT_CALENDAR_FIELD).toBe("taken");
    expect(CALENDAR_FIELDS).toEqual(["taken", "imported", "created"]);
  });
  it("monthStringRange gives ISO text bounds, rolling December", () => {
    expect(monthStringRange("2024-06")).toEqual({ gte: "2024-06-01", lt: "2024-07-01" });
    expect(monthStringRange("2024-12")).toEqual({ gte: "2024-12-01", lt: "2025-01-01" });
  });
});
