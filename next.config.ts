import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep canonical metadata in the head across map-to-page navigation.
  htmlLimitedBots: /.*/,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
    ],
  },
};

export default nextConfig;
