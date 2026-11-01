import { NextResponse } from "next/server";
import { crossSite, jsonError, jsonOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientMeta, createSession, currentUser, revokeAllSessions, sessionCookieOptions } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/config";
import { hashPassword, passwordProblems, verifyPassword } from "@/lib/crypto";
import { one, run } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError("Autenticazione richiesta.", 401);
  if (crossSite(req)) return jsonError("Richiesta cross-site bloccata.", 403);

  const { ip, userAgent } = await clientMeta();
  if (!rateLimit(`pwd:${user.id}`, 5, 10 * 60_000).ok) return jsonError("Troppi tentativi. Attendi qualche minuto.", 429);

  let body: { current?: unknown; next?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("Richiesta non valida.");
  }

  const current = String(body.current ?? "");
  const next = String(body.next ?? "");
  const row = one<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", user.id);
  if (!row) return jsonError("Account non trovato.", 404);
  if (!verifyPassword(row.password_hash, current)) {
    audit(user.id, "auth.password.failed", user.id, null, ip);
    return jsonError("Password attuale non corretta.", 401);
  }
  const problems = passwordProblems(next);
  if (problems.length) return jsonError(`La nuova password deve contenere ${problems.join(", ")}.`);
  if (next === current) return jsonError("La nuova password deve essere diversa da quella attuale.");

  run("UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?", hashPassword(next), user.id);
  revokeAllSessions(user.id);
  const { token } = createSession(user.id, ip, userAgent);
  audit(user.id, "auth.password.changed", user.id, null, ip);

  const res = NextResponse.json({ ok: true, data: { changed: true } });
  res.cookies.set(COOKIE_NAME, token, sessionCookieOptions);
  return res;
}
