import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

// Rasterizes the Lumio brand mark (the Aperture glyph, shared with the web app —
// see apps/web/src/app/icon.svg) into the full PNG icon set Expo needs, replacing
// the default Expo template art. Re-run with `node scripts/generate-icons.mjs`
// whenever the mark changes.
const here = path.dirname(fileURLToPath(import.meta.url));
const images = path.resolve(here, "..", "assets", "images");

const BLACK = "#000000";
const WHITE = "#ffffff";
const DENSITY = 512; // high render density so downscaled PNGs stay crisp

// The Aperture mark lives in a 24×24 viewBox. `coverage` is the fraction of the
// square canvas the glyph spans; the group is scaled and centered to fit.
function apertureSvg({ size, background, stroke, coverage }) {
  const scale = (size * coverage) / 24;
  const offset = (size - 24 * scale) / 2;
  const bgRect = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bgRect}
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="m14.31 8 5.74 9.94"/>
    <path d="M9.69 8h11.48"/>
    <path d="m7.38 12 5.74-9.94"/>
    <path d="M9.69 16 3.95 6.06"/>
    <path d="M14.31 16H2.83"/>
    <path d="m16.62 12-5.74 9.94"/>
  </g>
</svg>`;
}

function solidSvg({ size, fill }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${fill}"/></svg>`;
}

async function render(svg, size, outName) {
  const out = path.join(images, outName);
  await sharp(Buffer.from(svg), { density: DENSITY }).resize(size, size).png().toFile(out);
  console.log(`  assets/images/${outName} (${size}×${size})`);
}

async function main() {
  console.log("Generating Lumio mobile icons…");

  // App store / launcher icon: full-bleed black square, white glyph. The OS
  // applies its own corner mask, so no rounding here.
  await render(apertureSvg({ size: 1024, background: BLACK, stroke: WHITE, coverage: 0.6 }), 1024, "icon.png");
  await render(apertureSvg({ size: 48, background: BLACK, stroke: WHITE, coverage: 0.62 }), 48, "favicon.png");

  // Android adaptive icon: foreground/monochrome glyphs sit inside the ~66% safe
  // zone (the launcher crops the outer ring); the background is a solid plate.
  await render(apertureSvg({ size: 512, background: null, stroke: WHITE, coverage: 0.42 }), 512, "android-icon-foreground.png");
  await render(solidSvg({ size: 512, fill: BLACK }), 512, "android-icon-background.png");
  await render(apertureSvg({ size: 432, background: null, stroke: WHITE, coverage: 0.5 }), 432, "android-icon-monochrome.png");

  // Splash mark: transparent so it floats on the black splash background.
  await render(apertureSvg({ size: 512, background: null, stroke: WHITE, coverage: 0.7 }), 512, "splash-icon.png");

  // In-app logo: transparent glyph recolored per theme via expo-image tintColor,
  // so the source color is irrelevant (kept white).
  await render(apertureSvg({ size: 512, background: null, stroke: WHITE, coverage: 0.78 }), 512, "logo-mark.png");

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
