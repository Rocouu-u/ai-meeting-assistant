import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  output: "standalone",
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules/**",
        "**/.next/**",
        "**/.next-local/**",
        "**/.next-dev/**",
        "**/.next-dev-3006/**",
        "**/.next-build/**",
        "**/.git/**",
        "**/.npm-cache/**"
      ]
    };

    return config;
  }
};

export default nextConfig;
