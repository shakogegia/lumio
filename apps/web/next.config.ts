import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@lumio/db", "@lumio/shared"],
  experimental: {
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    },
  },
};

export default nextConfig;
