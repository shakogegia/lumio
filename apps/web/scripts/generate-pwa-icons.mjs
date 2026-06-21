import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

// Rasterizes the app-icon source SVGs into the PNG set the manifest + iOS need.
// Run with `pnpm gen:icons` whenever the brand mark changes.
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const iconsDir = path.join(webRoot, "public", "icons");
const appDir = path.join(webRoot, "src", "app");

// High render density so downscaled PNGs stay crisp.
const DENSITY = 512;

async function render(svgPath, size, outPath, { flatten = false } = {}) {
  const svg = await readFile(svgPath); // throws (→ exit 1) if the source is missing
  let img = sharp(svg, { density: DENSITY }).resize(size, size);
  if (flatten) img = img.flatten({ background: "#000000" });
  await img.png().toFile(outPath);
  console.log(`  ${path.relative(webRoot, outPath)} (${size}x${size})`);
}

async function main() {
  const icon = path.join(iconsDir, "icon.svg");
  const maskable = path.join(iconsDir, "icon-maskable.svg");

  console.log("Generating PWA icons…");
  await render(icon, 192, path.join(iconsDir, "icon-192.png"));
  await render(icon, 512, path.join(iconsDir, "icon-512.png"));
  await render(maskable, 512, path.join(iconsDir, "icon-maskable-512.png"));
  // iOS home-screen icon: flatten the rounded transparent corners to black
  // (iOS applies its own squircle mask), full-bleed 180px square.
  await render(icon, 180, path.join(appDir, "apple-icon.png"), { flatten: true });
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
