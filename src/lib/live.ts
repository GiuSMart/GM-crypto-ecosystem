import { audit } from "./audit";
import type { EngineSettings } from "./config";
import { newId } from "./crypto";
import { one, run } from "./db";

export type LiveAuthorization = {
  id: string;
  user_id: string;
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
  max_order_quote: number;
  max_daily_loss_quote: number;
  note: string | null;
};

export function activeLiveAuthorization(userId: string): LiveAuthorization | null {
  return one<LiveAuthorization>(
    "SELECT * FROM live_authorizations WHERE user_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC LIMIT 1",
    userId,
  );
}

export function grantLiveAuthorization(
  adminId: string,
  userId: string,
  opts: { maxOrderQuote: number; maxDailyLossQuote: number; note?: string },
): LiveAuthorization {
  const id = newId("live");
  run(
    `INSERT INTO live_authorizations(id, user_id, granted_by, granted_at, revoked_at, max_order_quote, max_daily_loss_quote, note)
     VALUES(?,?,?,?,NULL,?,?,?)`,
    id,
    userId,
    adminId,
    new Date().toISOString(),
    opts.maxOrderQuote,
    opts.maxDailyLossQuote,
    opts.note ?? null,
  );
  audit(adminId, "live.grant", userId, opts, null);
  return one<LiveAuthorization>("SELECT * FROM live_authorizations WHERE id = ?", id)!;
}

export function revokeLiveAuthorization(adminId: string, userId: string) {
  run("UPDATE live_authorizations SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", new Date().toISOString(), userId);
  audit(adminId, "live.revoke", userId, null, null);
}

/**
 * Everything that still blocks live execution. The last entry is unconditional in
 * this build on purpose: the order router is not implemented, so nothing can ever
 * reach a real venue. The UI shows this list verbatim instead of a fake "ready" state.
 */
export function liveBlockers(input: {
  authorization: LiveAuthorization | null;
  settings: EngineSettings;
  credentialCount: number;
}): string[] {
  const blockers: string[] = [];
  if (!input.settings.liveTradingEnabled) blockers.push("Interruttore live trading disattivato nelle impostazioni dell'account.");
  if (!input.authorization) blockers.push("Nessuna autorizzazione esplicita dell'amministratore.");
  if (input.credentialCount === 0) blockers.push("Nessuna API key registrata con permessi in sola lettura.");
  if (input.settings.maxOrderQuote <= 0) blockers.push("Limite di capitale per ordine non configurato.");
  blockers.push("Order router live non implementato in questa build: architettura predisposta, esecuzione impossibile per progetto.");
  return blockers;
}

/**
 * Intentional hard stop. Any future implementation must pass through this guard,
 * so a missing limit can never become an unbounded real order.
 */
export async function executeLiveOrder(): Promise<never> {
  throw new Error(
    "Esecuzione live non disponibile: questa versione non invia ordini reali. Nessuna API di trading viene chiamata.",
  );
}
