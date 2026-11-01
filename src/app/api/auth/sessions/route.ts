import { NextResponse } from "next/server";
import { crossSite, jsonError, jsonOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientMeta, currentUser, revokeAllSessions } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/config";

export async function DELETE(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError("Autenticazione richiesta.", 401);
  if (crossSite(req)) return jsonError("Richiesta cross-site bloccata.", 403);

  revokeAllSessions(user.id);
  const { ip } = await clientMeta();
  audit(user.id, "auth.sessions.revoke_all", user.id, null, ip);

  const res = NextResponse.json({ ok: true, data: { revoked: true } });
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  return res;
}
