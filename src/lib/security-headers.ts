/**
 * Security response headers.
 *
 * Kept out of next.config.ts so the policy can be asserted in tests instead of
 * only being read by eye.
 */

export type SecurityHeader = { key: string; value: string };

/**
 * Content-Security-Policy for the App Router.
 *
 * `script-src` has to allow inline scripts: the App Router streams its hydration
 * payload through inline `<script>` tags and this app has no middleware, so there
 * is no per-request nonce to whitelist them with. A nonce-based policy would mean
 * minting the nonce in middleware and losing static rendering, which is a bigger
 * change than a header. Everything else is locked down, which is what actually
 * matters here: no third-party script origins, no framing, no <base> hijack, no
 * plugin content.
 *
 * Dev additionally needs 'unsafe-eval' (webpack eval source maps) and `ws:`/`wss:`
 * for hot reload; production gets neither.
 *
 * `style-src` allows inline styles because Next injects critical CSS inline and
 * the pages use style attributes (which inherit style-src); there is no remote
 * stylesheet, font or image origin in the app, so nothing else is whitelisted.
 */
export function buildContentSecurityPolicy({ production }: { production: boolean }): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${production ? "" : " ws: wss:"}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export function buildSecurityHeaders({ production }: { production: boolean }): SecurityHeader[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=(), payment=(), usb=()" },
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy({ production }) },
    // HSTS is emitted only for production builds. Enable it only when the public
    // application is served exclusively over HTTPS.
    ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  ];
}
