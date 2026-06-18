import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@lumio/db", "@lumio/shared", "@lumio/ingest"],
  serverExternalPackages: ["sharp"],
  // When Conductor runs this workspace behind the portless proxy, the browser
  // origin is `<workspace>.lumio.localhost`, not localhost. Next 16 blocks
  // dev-server requests from other origins unless they're allow-listed here.
  // Derived from the Conductor workspace name (present via dotenv at dev time);
  // undefined for plain localhost runs, which need no allow-list.
  allowedDevOrigins: process.env.CONDUCTOR_WORKSPACE_NAME
    ? [`${process.env.CONDUCTOR_WORKSPACE_NAME}.lumio.localhost`]
    : undefined,
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
};

export default nextConfig;
