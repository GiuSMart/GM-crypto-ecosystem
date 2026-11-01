import { guardedMutation, jsonError, jsonOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientMeta } from "@/lib/auth";
import { VENUE_MAP } from "@/lib/config";
import { newId } from "@/lib/crypto";
import { all, run } from "@/lib/db";

export const runtime = "nodejs";

/** Address formats we accept for watch-only wallets. Never a seed phrase. */
const ADDRESS_RE = /^[A-Za-z0-9:_-]{8,120}$/;

export async function GET() {
  const { user, error } = await guardedMutation(new Request("http://local/"), { limit: 60, windowMs: 60_000 });
  if (error || !user) return error ?? jsonError("Autenticazione richiesta.", 401);
  return jsonOk(all("SELECT id, platform, label, address, chain, mode, created_at FROM wallets WHERE user_id = ? ORDER BY created_at DESC", user.id));
}

export async function POST(req: Request) {
  const { user, error } = await guardedMutation(req, { limit: 20, windowMs: 60_000 });
  if (error || !user) return error ?? jsonError("Autenticazione richiesta.", 401);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Richiesta non valida.");
  }

  const platform = String(body.platform ?? "");
  const label = String(body.label ?? "").trim().slice(0, 60);
  const address = String(body.address ?? "").trim();
  const chain = body.chain === undefined || body.chain === null ? null : String(body.chain).slice(0, 40);

  const venue = VENUE_MAP[platform];
  if (!venue) return jsonError("Piattaforma non riconosciuta.");
  if (venue.kind === "exchange") {
    return jsonError("Per gli exchange usa la sezione API key: gli indirizzi valgono solo per i wallet.");
  }
  if (label.length < 2) return jsonError("Dai un nome al wallet.");
  if (address.split(/\s+/).length > 1) {
    return jsonError("Inserisci solo l'indirizzo pubblico. Non digitare mai una seed phrase o una chiave privata.");
  }
  if (!ADDRESS_RE.test(address)) return jsonError("Indirizzo non valido: usa solo l'indirizzo pubblico.");

  const id = newId("wal");
  run(
    "INSERT INTO wallets(id, user_id, platform, label, address, chain, mode, created_at) VALUES(?,?,?,?,?,?,'watch',?)",
    id,
    user.id,
    platform,
    label,
    address,
    chain,
    new Date().toISOString(),
  );
  const { ip } = await clientMeta();
  audit(user.id, "wallet.add", id, { platform }, ip);
  return jsonOk({ id });
}

export async function DELETE(req: Request) {
  const { user, error } = await guardedMutation(req, { limit: 20, windowMs: 60_000 });
  if (error || !user) return error ?? jsonError("Autenticazione richiesta.", 401);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return jsonError("id mancante.");
  run("DELETE FROM wallets WHERE id = ? AND user_id = ?", id, user.id);
  const { ip } = await clientMeta();
  audit(user.id, "wallet.delete", id, null, ip);
  return jsonOk({ deleted: id });
}
