import { NextResponse } from "next/server";
import { currentUser, clientMeta, type SessionUser } from "./auth";
import { rateLimit, sweepRateLimiter } from "./rate-limit";

export const jsonOk = <T>(data: T, init?: ResponseInit) =>
  NextResponse.json({ ok: true, data }, { status: 200, ...init });

export const jsonError = (message: string, status = 400, extra?: Record<string, unknown>) =>
  NextResponse.json({ ok: false, error: message, ...extra }, { status });

/**
 * Cookie-authenticated mutations must be same-origin. Combined with SameSite=Lax
 * cookies this blocks cross-site request forgery without a token round trip.
 */
export function crossSite(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  const origin = req.headers.get("origin");
  if (!origin) return false; // same-origin navigations may omit Origin
  try {
    const o = new URL(origin);
    const host = req.headers.get("host");
    return o.host !== host;
  } catch {
    return true;
  }
}

export async function authGuard(): Promise<SessionUser | null> {
  return currentUser();
}

/** Wrap a mutating handler with auth + same-origin + rate limit. */
export async function guardedMutation(
  req: Request,
  opts: { limit: number; windowMs: number; adminOnly?: boolean; requireUser?: boolean },
): Promise<{ user: SessionUser | null; error?: NextResponse }> {
  const user = await currentUser();
  if (opts.requireUser !== false && !user) return { user: null, error: jsonError("Autenticazione richiesta.", 401) };
  if (opts.adminOnly && user?.role !== "admin") return { user, error: jsonError("Permesso negato.", 403) };
  // A bootstrap password only opens the app; every mutation waits until it has
  // actually been rotated. /api/auth/password does not use this helper, so
  // rotation is always possible.
  if (user?.mustChangePassword) {
    return { user, error: jsonError("Cambia la password iniziale prima di modificare i dati.", 403) };
  }
  if (crossSite(req)) return { user, error: jsonError("Richiesta cross-site bloccata.", 403) };

  const { ip } = await clientMeta();
  const res = rateLimit(`api:${new URL(req.url).pathname}:${user?.id ?? ip}`, opts.limit, opts.windowMs);
  sweepRateLimiter();
  if (!res.ok) {
    return {
      user,
      error: jsonError("Troppe richieste. Attendi qualche secondo.", 429, { retryAfterSec: res.retryAfterSec }),
    };
  }
  return { user };
}

export function numberFrom(v: unknown, fallback: number, min?: number, max?: number): number {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v ?? ""));
  if (!Number.isFinite(n)) return fallback;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}
