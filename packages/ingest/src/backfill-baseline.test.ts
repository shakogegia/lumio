import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { backfillBaselines } from "./backfill-baseline.js";

async function writeThumb(cacheRoot: string, catalogId: string, id: string, grey = 128): Promise<void> {
  const dir = path.join(cacheRoot, catalogId, "thumbnails");
  await mkdir(dir, { recursive: true });
  const buf = await sharp({ create: { width: 32, height: 32, channels: 3, background: { r: grey, g: grey, b: grey } } })
    .webp()
    .toBuffer();
  await writeFile(path.join(dir, `${id}.webp`), buf);
}

describe("backfillBaselines", () => {
  it("estimates + stores a baseline only for unedited photos with a readable thumbnail", async () => {
    const cacheRoot = await mkdtemp(path.join(tmpdir(), "lumio-backfill-"));
    await writeThumb(cacheRoot, "c1", "p1"); // unedited + thumbnail → updated
    await writeThumb(cacheRoot, "c1", "p2"); // edited → skipped
    // p3: unedited but NO thumbnail on disk → estimate returns null → skipped

    const updates: { id: string; asShotTempK: number; asShotTint: number }[] = [];
    const db = {
      photo: {
        findMany: vi.fn(async () => [
          { id: "p1", catalogId: "c1", edits: null },
          { id: "p2", catalogId: "c1", edits: { rotate: 0, temperature: 4000 } },
          { id: "p3", catalogId: "c1", edits: null },
        ]),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: { asShotTempK: number; asShotTint: number } }) => {
          updates.push({ id: where.id, ...data });
          return {};
        }),
      },
    } as unknown as Parameters<typeof backfillBaselines>[0];

    const n = await backfillBaselines(db, cacheRoot);

    expect(n).toBe(1);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.id).toBe("p1");
    expect(updates[0]!.asShotTempK).toBeGreaterThan(6000);
    expect(updates[0]!.asShotTempK).toBeLessThan(7000);
  });
});
