import { guardedMutation, jsonError, jsonOk, numberFrom } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientMeta } from "@/lib/auth";
import { REFERENCE_FEES } from "@/lib/config";
import { setFeeOverride } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { user, error } = await guardedMutation(req, { limit: 20, windowMs: 60_000 });
  if (error || !user) return error ?? jsonError("Autenticazione richiesta.", 401);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Richiesta non valida.");
  }

  const venueId = String(body.venueId ?? "");
  if (!REFERENCE_FEES[venueId]) return jsonError("Venue senza commissioni configurate.");
  const makerPct = numberFrom(body.makerPct, 0, 0, 5);
  const takerPct = numberFrom(body.takerPct, 0, 0, 5);
  if (takerPct <= 0) return jsonError("Una fee taker a zero non è realistica: verifica il tuo tier.");
  const note = String(body.note ?? "").slice(0, 200) || "override manuale";
  const global = body.scope === "global" && user.role === "admin";

  setFeeOverride(venueId, makerPct, takerPct, note, global ? null : user.id);
  const { ip } = await clientMeta();
  audit(user.id, "fees.override", venueId, { makerPct, takerPct, note, global }, ip);

  return jsonOk({ venueId, makerPct, takerPct, scope: global ? "global" : "user" });
}
