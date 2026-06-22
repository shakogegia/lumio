import { describe, expect, it } from "vitest";
import { getUserSettings, updateUserSettings } from "./user-settings.js";

function fakeDb(initial?: { soundEffectsEnabled: boolean }) {
  let row = initial ? { userId: "u1", updatedAt: new Date(), ...initial } : null;
  return { userSettings: { upsert: async ({ create, update }: { create: any; update: any }) => { row = row ? { ...row, ...update } : { userId: "u1", updatedAt: new Date(), ...create }; return row; } } };
}

describe("getUserSettings", () => {
  it("creates defaults when absent (soundEffectsEnabled: true)", async () => { const s = await getUserSettings("u1", fakeDb() as never); expect(s.soundEffectsEnabled).toBe(true); });
});

describe("updateUserSettings", () => {
  it("writes only the provided fields", async () => { const s = await updateUserSettings("u1", { soundEffectsEnabled: false }, fakeDb({ soundEffectsEnabled: true }) as never); expect(s.soundEffectsEnabled).toBe(false); });
});
