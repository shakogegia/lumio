import { describe, expect, it } from "vitest";
import { calendarWhere } from "./calendar-where.js";

describe("calendarWhere", () => {
  it("filters a standard dimension on its column", () => {
    expect(calendarWhere("taken", "2024-06")).toMatchObject({ sortDate: { gte: expect.any(Date), lt: expect.any(Date) } });
    expect(calendarWhere("imported", "2024-06")).toHaveProperty("createdAt");
    expect(calendarWhere("created", "2024-06")).toHaveProperty("fileCreatedAt");
  });
  it("filters a metadata dimension via the child table with an ISO value range", () => {
    expect(calendarWhere("meta:clx1", "2024-12")).toEqual({
      metadataValues: { some: { fieldId: "clx1", value: { gte: "2024-12-01", lt: "2025-01-01" } } },
    });
  });
});
