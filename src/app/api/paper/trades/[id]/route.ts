import { guardedMutation, jsonError, jsonOk } from "@/lib/api";
import { clientMeta } from "@/lib/auth";
import { closePaperTrade } from "@/lib/paper";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { user, error } = await guardedMutation(req, { limit: 30, windowMs: 60_000 });
  if (error || !user) return error ?? jsonError("Autenticazione richiesta.", 401);

  const { id } = await ctx.params;
  if (!id) return jsonError("ID operazione mancante.");

  const { ip } = await clientMeta();
  const result = await closePaperTrade(user.id, id, ip);
  if (!result.ok) return jsonError(result.error, 409);
  return jsonOk(result);
}
