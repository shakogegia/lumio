import { describe, expect, it } from "vitest";
import { getSettings, updateSettings } from "./settings.js";

function fakeDb(row: { id: number; uploadTemplate: string; soundEffectsEnabled: boolean }) {
  const calls: unknown[] = [];
  return {
    calls,
    appSettings: {
      upsert: async (args: unknown) => {
        calls.push(args);
        return row;
      },
    },
  };
}

describe("getSettings", () => {
  it("upserts the singleton row (id=1) and returns both fields", async () => {
    const db = fakeDb({ id: 1, uploadTemplate: "{filename}", soundEffectsEnabled: true });
    const settings = await getSettings(db as never);
    expect(settings).toEqual({ uploadTemplate: "{filename}", soundEffectsEnabled: true });
    expect(db.calls[0]).toMatchObject({ where: { id: 1 }, create: { id: 1 }, update: {} });
  });
});

describe("updateSettings", () => {
  it("writes only uploadTemplate when only it is provided", async () => {
    const db = fakeDb({ id: 1, uploadTemplate: "{YYYY}/{filename}", soundEffectsEnabled: true });
    const settings = await updateSettings({ uploadTemplate: "{YYYY}/{filename}" }, db as never);
    expect(settings).toEqual({ uploadTemplate: "{YYYY}/{filename}", soundEffectsEnabled: true });
    expect(db.calls[0]).toMatchObject({
      where: { id: 1 },
      create: { id: 1, uploadTemplate: "{YYYY}/{filename}" },
      update: { uploadTemplate: "{YYYY}/{filename}" },
    });
  });

  it("writes only soundEffectsEnabled when only it is provided (no uploadTemplate key)", async () => {
    const db = fakeDb({ id: 1, uploadTemplate: "{filename}", soundEffectsEnabled: false });
    const settings = await updateSettings({ soundEffectsEnabled: false }, db as never);
    expect(settings.soundEffectsEnabled).toBe(false);
    const args = db.calls[0] as { create: object; update: object };
    expect(args).toMatchObject({
      where: { id: 1 },
      create: { id: 1, soundEffectsEnabled: false },
      update: { soundEffectsEnabled: false },
    });
    expect(args.update).not.toHaveProperty("uploadTemplate");
    expect(args.create).not.toHaveProperty("uploadTemplate");
  });
});
