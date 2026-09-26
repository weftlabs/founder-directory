import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep canonical metadata in the head across map-to-page navigation.
  htmlLimitedBots: /.*/,
  outputFileTracingIncludes: {
    "/u/*/share-image": [
      "./node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff",
    ],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "pbs.twimg.com" },
      { protocol: "https", hostname: "abs.twimg.com" },
    ],
  },
};

export default nextConfig;
