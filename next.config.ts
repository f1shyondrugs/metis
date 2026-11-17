import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  // Keep compiler heaps isolated even with the node:sqlite webpack customization.
  experimental: { webpackBuildWorker: true, webpackMemoryOptimizations: true },
  transpilePackages: ["jsxgraph"],
  // API seeding and the custom WebSocket server must share Yjs constructors.
  // This package reads VTIMEZONE assets relative to its own __dirname.
  // Bundling it changes that directory and silently makes every zone unavailable.
  serverExternalPackages: ["@cursor/sdk", "yjs", "@touch4it/ical-timezones", "timezones-ical-library"],
  distDir: process.env.NEXT_DIST_DIR || ".next",
  webpack: (config, { isServer }) => {
    if (isServer) {
      const previous = config.externals;
      config.externals = [
        // Match the custom server's CJS runtime instead of a second ESM Yjs instance.
        ({ request }: { request?: string }, callback: (error?: Error | null, result?: string) => void) => {
          if (request === "yjs") return callback(null, "commonjs yjs");
          callback();
        },
        ...(Array.isArray(previous) ? previous : previous ? [previous] : []),
        ({ request }: { request?: string }, callback: (error?: Error | null, result?: string) => void) => {
          if (request === "node:sqlite") return callback(null, "commonjs node:sqlite");
          callback();
        },
      ];
    }
    return config;
  },
};

export default nextConfig;
