import { guardedMutation, jsonError, jsonOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientMeta } from "@/lib/auth";
import { VENUE_MAP } from "@/lib/config";
import { encryptSecret, newId } from "@/lib/crypto";
import { all, one, run } from "@/lib/db";
import { planLimits } from "@/lib/plans";

export const runtime = "nodejs";

/**
 * API key registration.
 * Hard rules: read-only confirmation is mandatory, no withdrawal permission,
 * keys are encrypted at rest and never returned in clear.
 */
export async function POST(req: Request) {
  const { user, error } = await guardedMutation(req, { limit: 10, windowMs: 60_000 });
  if (error || !user) return error ?? jsonError("Autenticazione richiesta.", 401);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Richiesta non valida.");
  }

  const venueId = String(body.venueId ?? "");
  const label = String(body.label ?? "").trim().slice(0, 60) || "API key";
  const apiKey = String(body.apiKey ?? "").trim();
  const apiSecret = String(body.apiSecret ?? "").trim();

  const venue = VENUE_MAP[venueId];
  if (!venue) return jsonError("Venue non riconosciuta.");
  if (!venue.balanceReadable) return jsonError(`${venue.name} non espone un'API self-service per i saldi.`);
  if (body.confirmReadOnly !== true) {
    return jsonError("Devi confermare che la chiave ha permessi di sola lettura e prelievi disabilitati.");
  }
  if (apiKey.length < 8 || apiSecret.length < 8) return jsonError("API key o secret troppo corti.");
  if (/seed|phrase|mnemonic/i.test(apiKey) || apiKey.trim().split(/\s+/).length > 1) {
    return jsonError("Questa sembra una seed phrase. Non accettiamo seed phrase: crea una API key con permessi di sola lettura.");
  }

  const limits = planLimits(user.plan);
  const existing = all<{ id: string }>("SELECT id FROM credentials WHERE user_id = ?", user.id);
  if (existing.length >= limits.apiKeys) {
    return jsonError(`Il piano ${user.plan.toUpperCase()} consente ${limits.apiKeys} API key. Passa a un piano superiore.`, 403);
  }

  const id = newId("cred");
  run(
    `INSERT INTO credentials(id, user_id, venue_id, label, api_key_enc, api_secret_enc, permissions, withdrawals_enabled, created_at)
     VALUES(?,?,?,?,?,?,'read-only',0,?)`,
    id,
    user.id,
    venueId,
    label,
    encryptSecret(apiKey),
    encryptSecret(apiSecret),
    new Date().toISOString(),
  );

  const { ip } = await clientMeta();
  audit(user.id, "credential.add", id, { venueId, label }, ip);
  return jsonOk({ id, venueId, masked: `••••${apiKey.slice(-4)}` });
}

export async function DELETE(req: Request) {
  const { user, error } = await guardedMutation(req, { limit: 20, windowMs: 60_000 });
  if (error || !user) return error ?? jsonError("Autenticazione richiesta.", 401);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return jsonError("id mancante.");
  run("DELETE FROM credentials WHERE id = ? AND user_id = ?", id, user.id);
  const { ip } = await clientMeta();
  audit(user.id, "credential.delete", id, null, ip);
  return jsonOk({ deleted: id });
}
