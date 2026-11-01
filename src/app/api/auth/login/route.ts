import { NextResponse } from "next/server";
import { crossSite, jsonError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientMeta, createSession, login, sessionCookieOptions } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/config";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  if (crossSite(req)) return jsonError("Richiesta cross-site bloccata.", 403);

  const { ip, userAgent } = await clientMeta();
  const rl = rateLimit(`login:${ip}`, 8, 60_000);
  if (!rl.ok) return jsonError("Troppi tentativi di accesso. Riprova tra poco.", 429, { retryAfterSec: rl.retryAfterSec });

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("Richiesta non valida.");
  }

  const email = String(body.email ?? "").trim().slice(0, 200);
  const password = String(body.password ?? "");
  if (!email || !password) return jsonError("Email e password sono obbligatorie.");

  const result = login(email, password);
  if (!result.ok) {
    audit(null, "auth.login.failed", email, null, ip);
    return jsonError(result.error, 401);
  }

  const { token } = createSession(result.user.id, ip, userAgent);
  audit(result.user.id, "auth.login", result.user.email, null, ip);

  const res = NextResponse.json({
    ok: true,
    data: { role: result.user.role, mustChangePassword: result.user.mustChangePassword },
  });
  res.cookies.set(COOKIE_NAME, token, sessionCookieOptions);
  return res;
}
