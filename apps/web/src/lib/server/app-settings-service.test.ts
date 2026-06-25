import { describe, expect, it, vi } from "vitest";
import { getGeneralSettings, updateGeneralSettings, InvalidBaseUrlError } from "./app-settings-service.js";

describe("getGeneralSettings", () => {
  it("returns the stored base URL", async () => {
    const db = { appSetting: { findUnique: async () => ({ key: "publicBaseUrl", value: "https://x.test" }) } };
    expect(await getGeneralSettings(db as never)).toEqual({ publicBaseUrl: "https://x.test" });
  });
  it("returns null when unset", async () => {
    const db = { appSetting: { findUnique: async () => null } };
    expect(await getGeneralSettings(db as never)).toEqual({ publicBaseUrl: null });
  });
});

describe("updateGeneralSettings", () => {
  it("normalizes and stores a valid URL", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const db = { appSetting: { upsert } };
    const result = await updateGeneralSettings({ publicBaseUrl: "https://x.test/" }, db as never);
    expect(result).toEqual({ publicBaseUrl: "https://x.test" });
    expect(upsert).toHaveBeenCalledWith({
      where: { key: "publicBaseUrl" },
      create: { key: "publicBaseUrl", value: "https://x.test" },
      update: { value: "https://x.test" },
    });
  });
  it("clears the setting on empty input", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const db = { appSetting: { upsert } };
    const result = await updateGeneralSettings({ publicBaseUrl: "" }, db as never);
    expect(result).toEqual({ publicBaseUrl: null });
    expect(upsert).toHaveBeenCalledWith({
      where: { key: "publicBaseUrl" },
      create: { key: "publicBaseUrl", value: "" },
      update: { value: "" },
    });
  });
  it("throws InvalidBaseUrlError on a bad URL", async () => {
    const db = { appSetting: { upsert: vi.fn() } };
    await expect(updateGeneralSettings({ publicBaseUrl: "not a url" }, db as never)).rejects.toBeInstanceOf(
      InvalidBaseUrlError,
    );
  });
});
