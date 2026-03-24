import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "assets.leetcode.com",
      },
    ],
  },
};

export default nextConfig;
