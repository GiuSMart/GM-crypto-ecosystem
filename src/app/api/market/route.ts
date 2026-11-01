import { jsonError, jsonOk } from "@/lib/api";
import { clientMeta, currentUser } from "@/lib/auth";
import { QUOTES, type Quote } from "@/lib/config";
import { getUserSettings } from "@/lib/db";
import { getBoard } from "@/lib/market";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError("Autenticazione richiesta.", 401);

  const { ip } = await clientMeta();
  if (!rateLimit(`market:${user.id}:${ip}`, 40, 60_000).ok) {
    return jsonError("Troppe richieste di mercato. Attendi qualche secondo.", 429);
  }

  const url = new URL(req.url);
  const requested = (url.searchParams.get("quote") ?? getUserSettings(user.id).quote).toUpperCase();
  const quote = ((QUOTES as readonly string[]).includes(requested) ? requested : "USD") as Quote;

  try {
    const board = await getBoard(quote);
    return jsonOk(board, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(`Dati di mercato non disponibili: ${(err as Error).message}`, 502);
  }
}
