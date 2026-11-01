import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, SESSION_TTL_MS } from "./config";
import { all, one, run } from "./db";
import { newId, randomToken, sha256hex, verifyPassword } from "./crypto";
import { isProduction } from "./paths";

export type Role = "admin" | "client";

export type SessionUser = {
  id: string;
  email: string;
  role: Role;
  plan: string;
  displayName: string;
  brandName: string | null;
  brandAccent: string | null;
  mustChangePassword: boolean;
};

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  plan: string;
  display_name: string;
  brand_name: string | null;
  brand_accent: string | null;
  status: string;
  must_change_password: number;
  failed_logins: number;
  locked_until: number | null;
};

const toUser = (r: UserRow): SessionUser => ({
  id: r.id,
  email: r.email,
  role: r.role,
  plan: r.plan,
  displayName: r.display_name,
  brandName: r.brand_name,
  brandAccent: r.brand_accent,
  mustChangePassword: r.must_change_password === 1,
});

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: isProduction(),
  path: "/",
  maxAge: Math.floor(SESSION_TTL_MS / 1000),
};

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

export function createSession(userId: string, ip: string | null, userAgent: string | null) {
  const token = randomToken(32);
  const sessionId = sha256hex(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  run(
    "INSERT INTO sessions(id, user_id, created_at, expires_at, revoked, ip, user_agent) VALUES(?,?,?,?,0,?,?)",
    sessionId,
    userId,
    new Date().toISOString(),
    expiresAt,
    ip,
    userAgent ? userAgent.slice(0, 300) : null,
  );
  run("UPDATE users SET last_login_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?", new Date().toISOString(), userId);
  return { token, sessionId, expiresAt };
}

export function revokeSession(token: string) {
  run("UPDATE sessions SET revoked = 1 WHERE id = ?", sha256hex(token));
}

export function revokeAllSessions(userId: string) {
  run("UPDATE sessions SET revoked = 1 WHERE user_id = ?", userId);
}

export function listSessions(userId: string) {
  return all<{ id: string; created_at: string; expires_at: number; ip: string | null; user_agent: string | null; revoked: number }>(
    "SELECT id, created_at, expires_at, ip, user_agent, revoked FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20",
    userId,
  );
}

/** Resolve the signed-in user from the httpOnly cookie, or null. */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (!token) return null;
  const row = one<UserRow>(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.revoked = 0 AND s.expires_at > ? AND u.status = 'active'`,
    sha256hex(token),
    Date.now(),
  );
  return row ? toUser(row) : null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/?denied=admin");
  return user;
}

export async function clientMeta() {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "local";
  return { ip, userAgent: h.get("user-agent") };
}

/* -------------------------------------------------------------------------- */
/* Login                                                                       */
/* -------------------------------------------------------------------------- */

const LOCK_AFTER = 6;
const LOCK_MS = 15 * 60 * 1000;

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; error: string };

export function login(email: string, password: string): LoginResult {
  const user = one<UserRow>("SELECT * FROM users WHERE email = ?", email.trim().toLowerCase());
  // Uniform error message: never reveal whether the account exists.
  const generic = "Credenziali non valide.";
  if (!user) return { ok: false, error: generic };
  if (user.status !== "active") return { ok: false, error: "Account sospeso. Contatta l'amministratore." };
  if (user.locked_until && user.locked_until > Date.now()) {
    const mins = Math.ceil((user.locked_until - Date.now()) / 60000);
    return { ok: false, error: `Troppi tentativi. Riprova tra ${mins} minuti.` };
  }
  if (!verifyPassword(user.password_hash, password)) {
    const failures = user.failed_logins + 1;
    run(
      "UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?",
      failures,
      failures >= LOCK_AFTER ? Date.now() + LOCK_MS : null,
      user.id,
    );
    return { ok: false, error: generic };
  }
  return { ok: true, user: toUser(user) };
}
