import type { NextConfig } from "next";

// Fully static export: no server runtime. All live data is fetched in the
// browser from the public `data` branch of this repository.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
