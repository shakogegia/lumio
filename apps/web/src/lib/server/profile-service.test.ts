import { describe, expect, it, vi } from "vitest";

const getUserSettingsMock = vi.fn();
const updateUserSettingsMock = vi.fn();

vi.mock("@lumio/db", () => ({
  getUserSettings: (...args: unknown[]) => getUserSettingsMock(...args),
  updateUserSettings: (...args: unknown[]) => updateUserSettingsMock(...args),
}));

import { getProfile, updateProfile } from "./profile-service.js";

describe("getProfile", () => {
  it("passes userId through to getUserSettings and returns the result", async () => {
    const settings = { soundEffectsEnabled: true };
    getUserSettingsMock.mockResolvedValue(settings);
    const result = await getProfile("u1");
    expect(getUserSettingsMock).toHaveBeenCalledWith("u1");
    expect(result).toBe(settings);
  });
});

describe("updateProfile", () => {
  it("passes userId and input through to updateUserSettings and returns the result", async () => {
    const updated = { soundEffectsEnabled: false };
    updateUserSettingsMock.mockResolvedValue(updated);
    const result = await updateProfile("u1", { soundEffectsEnabled: false });
    expect(updateUserSettingsMock).toHaveBeenCalledWith("u1", { soundEffectsEnabled: false });
    expect(result).toBe(updated);
  });
});
