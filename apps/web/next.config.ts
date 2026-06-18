import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@lumio/db", "@lumio/shared", "@lumio/ingest"],
  serverExternalPackages: ["sharp"],
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
