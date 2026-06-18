import { describe, expect, it } from "vitest";
import { getSettings, updateSettings } from "./settings.js";

function fakeDb(row: { id: number; uploadTemplate: string }) {
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
  it("upserts the singleton row (id=1) and returns it", async () => {
    const db = fakeDb({ id: 1, uploadTemplate: "{filename}" });
    const settings = await getSettings(db as never);
    expect(settings.uploadTemplate).toBe("{filename}");
    expect(db.calls[0]).toMatchObject({ where: { id: 1 }, create: { id: 1 }, update: {} });
  });
});

describe("updateSettings", () => {
  it("upserts the singleton row with the new template", async () => {
    const db = fakeDb({ id: 1, uploadTemplate: "{YYYY}/{filename}" });
    const settings = await updateSettings({ uploadTemplate: "{YYYY}/{filename}" }, db as never);
    expect(settings.uploadTemplate).toBe("{YYYY}/{filename}");
    expect(db.calls[0]).toMatchObject({
      where: { id: 1 },
      create: { id: 1, uploadTemplate: "{YYYY}/{filename}" },
      update: { uploadTemplate: "{YYYY}/{filename}" },
    });
  });
});
