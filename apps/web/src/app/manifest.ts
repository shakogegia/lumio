import type { MetadataRoute } from "next";

// The web app manifest. Next serves this at /manifest.webmanifest and
// auto-injects <link rel="manifest"> into every page's <head>.
// Installability metadata only — no service worker, no offline behavior.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lumio",
    short_name: "Lumio",
    description: "Your photo library.",
    // `/` redirects to `/photos`; start there directly to skip the hop on launch.
    start_url: "/photos",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
