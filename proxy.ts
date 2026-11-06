import { NextRequest, NextResponse } from "next/server";
import { buildSecurityHeaders } from "./src/lib/security-headers";

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const production = process.env.NODE_ENV === "production";
  const securityHeaders = buildSecurityHeaders({ production, nonce });
  const csp = securityHeaders.find((header) => header.key === "Content-Security-Policy")?.value;

  if (!csp) {
    throw new Error("Content-Security-Policy header was not generated.");
  }

  // Override any client-supplied values: Next must read the same policy/nonce
  // that will be emitted on the response in order to nonce its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  for (const { key, value } of securityHeaders) {
    response.headers.set(key, value);
  }
  return response;
}

export const config = {
  matcher: ["/:path*"],
};
