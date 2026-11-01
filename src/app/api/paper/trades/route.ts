import { guardedMutation, jsonError, jsonOk } from "@/lib/api";
import { clientMeta } from "@/lib/auth";
import { openPaperTrade } from "@/lib/paper";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(req: Request) {
  const { user, error } = await guardedMutation(req, { limit: 20, windowMs: 60_000 });
  if (error || !user) return error ?? jsonError("Autenticazione richiesta.", 401);

  let body: { opportunityId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("Richiesta non valida.");
  }
  const opportunityId = String(body.opportunityId ?? "");
  if (!opportunityId) return jsonError("opportunityId mancante.");

  const { ip } = await clientMeta();
  const result = await openPaperTrade(user.id, opportunityId, ip);
  if (!result.ok) return jsonError(result.error, 409, { reasons: result.reasons });
  return jsonOk(result);
}
