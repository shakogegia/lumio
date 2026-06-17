import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PHOTOS_DIR } from "../src/config.js";

const COUNT = 200;
const COLORS = [
  "#e63946", "#f1faee", "#a8dadc", "#457b9d", "#1d3557", "#2a9d8f",
  "#e9c46a", "#f4a261", "#e76f51", "#264653", "#8ecae6", "#ffb703",
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

async function main(): Promise<void> {
  await rm(PHOTOS_DIR, { recursive: true, force: true });
  await mkdir(PHOTOS_DIR, { recursive: true });

  for (let i = 0; i < COUNT; i++) {
    const width = 600 + (i % 4) * 100;
    const height = 400 + (i % 3) * 100;
    const dateTimeOriginal = `2024:0${(i % 9) + 1}:${pad((i % 27) + 1)} 1${i % 9}:30:00`;
    const filename = `sample-${String(i + 1).padStart(3, "0")}.jpg`;

    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: COLORS[i % COLORS.length] ?? "#888888",
      },
    })
      .withExif({
        IFD0: { Make: "Lumio", Model: `TestCam ${(i % 3) + 1}` },
        IFD2: { DateTimeOriginal: dateTimeOriginal },
      })
      .jpeg()
      .toFile(path.join(PHOTOS_DIR, filename));

    console.log(`wrote ${filename} (${width}x${height})`);
  }

  console.log(`Seeded ${COUNT} sample photos into ${PHOTOS_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
