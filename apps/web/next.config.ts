import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@lumio/db", "@lumio/shared"],
};

export default nextConfig;
