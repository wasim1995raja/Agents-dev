import type { NextConfig } from "next";

/**
 * The dashboard talks to the Fastify API over HTTP. The workspace packages ship
 * TypeScript sources, so they must be transpiled by the app bundler.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@autodev/shared"],
  poweredByHeader: false,
  // The dashboard is opened over 127.0.0.1 in tests and over localhost in dev;
  // Next block-lists dev assets from the "other" host unless it is listed.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Do not write AGENTS.md into the tree on every `next dev`.
  agentRules: false,
};

export default nextConfig;
