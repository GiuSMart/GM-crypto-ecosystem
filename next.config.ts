import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Dev-only: allow the Cloud preview host to load dev assets.
  allowedDevOrigins: ["pv-5962f7acaa51-3eadfe9e-65d0-4a5e-8e5f-f7bb2dc564bc.style.dev"],
  // The arbitrage engine talks to public exchange REST APIs from the Node runtime.
  // node:sqlite is a Node built-in, so every DB-backed page must stay on the Node runtime.
  serverExternalPackages: [],
};

export default nextConfig;
