import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { crossSite, jsonError } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientMeta, createSession, sessionCookieOptions } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/config";
import { hashPassword, newId, passwordProblems } from "@/lib/crypto";
import { one, run } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[a-zA-Z]{2,}$/;

export async function POST(req: Request) {
  if (crossSite(req)) return jsonError("Richiesta cross-site bloccata.", 403);

  const { ip, userAgent } = await clientMeta();
  const rl = rateLimit(`register:${ip}`, 3, 10 * 60_000);
  if (!rl.ok) return jsonError("Troppi tentativi di registrazione. Riprova più tardi.", 429, { retryAfterSec: rl.retryAfterSec });

  let body: { displayName?: unknown; email?: unknown; password?: unknown; inviteCode?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("Richiesta non valida.");  const expectedCode = process.env.GM_TESTER_INVITE_CODE ?? "";
  const suppliedCode = String(body.inviteCode ?? "");

  if (!expectedCode || !suppliedCode) {
    return jsonError("Codice d'invito non valido.", 403);
  }

  const expectedBuffer = Buffer.from(expectedCode);
  const suppliedBuffer = Buffer.from(suppliedCode);

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    return jsonError("Codice d'invito non valido.", 403);
  }
  }

  const displayName = String(body.displayName ?? "").trim().slice(0, 80);
  const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(body.password ?? "");

  if (displayName.length < 2) return jsonError("Inserisci un nome valido.");
  if (!EMAIL_RE.test(email)) return jsonError("Indirizzo email non valido.");

  const problems = passwordProblems(password);
  if (problems.length) return jsonError(`La password deve contenere ${problems.join(", ")}.`);

  if (one("SELECT id FROM users WHERE email = ?", email)) {
    return jsonError("Esiste già un account con questa email.", 409);
  }

  const id = newId("usr");
  const now = new Date().toISOString();
  run(
    `INSERT INTO users(id, email, password_hash, role, plan, display_name, status, must_change_password, created_at)
     VALUES(?,?,?,'client','free',?,'active',0,?)`,
    id,
    email,
    hashPassword(password),
    displayName,
    now,
  );
  run(
    `INSERT INTO subscriptions(id, user_id, plan_id, status, started_at, note) VALUES(?,?,?,?,?,?)`,
    newId("sub"),
    id,
    "free",
    "active",
    now,
    "Piano FREE di default: nessun pagamento richiesto.",
  );

  const { token } = createSession(id, ip, userAgent);
  audit(id, "auth.register", email, { plan: "free" }, ip);

  const res = NextResponse.json({ ok: true, data: { id } });
  res.cookies.set(COOKIE_NAME, token, sessionCookieOptions);
  return res;
}
