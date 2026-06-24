import { describe, it, expect } from "vitest";
import { formatPhotoTitle } from "./viewer-title";

describe("formatPhotoTitle", () => {
  it("formats the capture date + time when takenAt is present", () => {
    const t = formatPhotoTitle({ takenAt: "2019-12-04T14:07:00.000Z", path: "/x/DSC1.jpg" });
    expect(t.title).toBe("December 4, 2019");
    expect(t.subtitle).toBe("2:07 PM");
  });
  it("formats midnight and noon correctly", () => {
    expect(formatPhotoTitle({ takenAt: "2020-01-01T00:00:00.000Z", path: "a" }).subtitle).toBe(
      "12:00 AM",
    );
    expect(formatPhotoTitle({ takenAt: "2020-01-01T12:30:00.000Z", path: "a" }).subtitle).toBe(
      "12:30 PM",
    );
  });
  it("falls back to the filename when there is no date", () => {
    const t = formatPhotoTitle({ takenAt: null, path: "/photos/sub/IMG_0420.heic" });
    expect(t.title).toBe("IMG_0420.heic");
    expect(t.subtitle).toBeUndefined();
  });
});
