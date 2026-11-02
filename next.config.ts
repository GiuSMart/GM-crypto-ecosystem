import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=(), payment=(), usb=()" },
  // HSTS is emitted only for production builds. Enable it only when the public
  // application is served exclusively over HTTPS.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
    : []),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Dev-only: allow the Cloud preview host to load dev assets.
  allowedDevOrigins: ["pv-5962f7acaa51-3eadfe9e-65d0-4a5e-8e5f-f7bb2dc564bc.style.dev"],
  // The arbitrage engine talks to public exchange REST APIs from the Node runtime.
  // node:sqlite is a Node built-in, so every DB-backed page must stay on the Node runtime.
  serverExternalPackages: [],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
