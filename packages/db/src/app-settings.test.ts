import { describe, expect, it, vi } from "vitest";
import { getAppSetting, setAppSetting } from "./app-settings.js";

describe("getAppSetting", () => {
  it("returns the value when a row exists", async () => {
    const findUnique = vi.fn().mockResolvedValue({ key: "publicBaseUrl", value: "https://x.test" });
    const db = { appSetting: { findUnique } };
    expect(await getAppSetting("publicBaseUrl", db as never)).toBe("https://x.test");
    expect(findUnique).toHaveBeenCalledWith({ where: { key: "publicBaseUrl" } });
  });

  it("returns null when no row exists", async () => {
    const db = { appSetting: { findUnique: async () => null } };
    expect(await getAppSetting("publicBaseUrl", db as never)).toBeNull();
  });
});

describe("setAppSetting", () => {
  it("upserts the key/value", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const db = { appSetting: { upsert } };
    await setAppSetting("publicBaseUrl", "https://x.test", db as never);
    expect(upsert).toHaveBeenCalledWith({
      where: { key: "publicBaseUrl" },
      create: { key: "publicBaseUrl", value: "https://x.test" },
      update: { value: "https://x.test" },
    });
  });
});
