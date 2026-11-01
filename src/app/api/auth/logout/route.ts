import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { audit } from "@/lib/audit";
import { clientMeta, revokeSession } from "@/lib/auth";
import { COOKIE_NAME } from "@/lib/config";

export async function POST() {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) revokeSession(token);
  const { ip } = await clientMeta();
  audit(null, "auth.logout", null, null, ip);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  return res;
}
