/**
 * Security response headers.
 *
 * CSP is generated per request by proxy.ts so Next.js can extract the nonce
 * from the forwarded request header and apply it to framework/hydration scripts.
 */

export type SecurityHeader = { key: string; value: string };

export function buildContentSecurityPolicy({
  production,
  nonce,
}: {
  production: boolean;
  nonce: string;
}): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(nonce)) {
    throw new Error("A valid per-request base64 CSP nonce is required.");
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval'"}`,
    // The UI currently uses React style attributes; nonce sources do not
    // authorize style attributes, so keep this exception until those are removed.
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

export function buildSecurityHeaders({
  production,
  nonce,
}: {
  production: boolean;
  nonce: string;
}): SecurityHeader[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "geolocation=(), microphone=(), camera=(), payment=(), usb=()" },
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy({ production, nonce }) },
    ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  ];
}
