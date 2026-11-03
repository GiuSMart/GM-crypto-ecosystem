import { guardedMutation, jsonError, jsonOk, numberFrom } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientMeta } from "@/lib/auth";
import { newId } from "@/lib/crypto";
import { all, one, run } from "@/lib/db";
import { findDuplicateReferral, mergeReferralInput, type ExistingReferral } from "@/lib/referrals";
import { grantLiveAuthorization, revokeLiveAuthorization } from "@/lib/live";
import { setUserPlan, updatePlanPricing } from "@/lib/plans";

export const runtime = "nodejs";

/**
 * Read model for the transfer scripts: the catalogue as stored, ids and flags
 * included. Verification cannot use the public page alone, because a disabled
 * offer is absent from it by design and would look like a failed import.
 */
export async function GET(req: Request) {
  const { user, error } = await guardedMutation(req, { limit: 60, windowMs: 60_000, adminOnly: true });
  if (error || !user) return error ?? jsonError("Permesso negato.", 403);
  const referrals = all(
    "SELECT id, platform, name, url, category, active, verified, affiliate_confirmed, sort, updated_at FROM referrals ORDER BY sort ASC, name ASC",
  );
  return jsonOk({ referrals }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const { user, error } = await guardedMutation(req, { limit: 30, windowMs: 60_000, adminOnly: true });
  if (error || !user) return error ?? jsonError("Permesso negato.", 403);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Richiesta non valida.");
  }

  const action = String(body.action ?? "");
  const { ip } = await clientMeta();

  try {
    switch (action) {
      case "assign_plan": {
        const userId = String(body.userId ?? "");
        const planId = String(body.planId ?? "");
        if (!userId || !planId) return jsonError("userId e planId sono obbligatori.");
        setUserPlan(userId, planId, user.id);
        audit(user.id, "admin.assign_plan", userId, { planId }, ip);
        return jsonOk({ userId, planId });
      }

      case "set_role": {
        const userId = String(body.userId ?? "");
        const role = body.role === "admin" ? "admin" : "client";
        if (userId === user.id) return jsonError("Non puoi cambiare il tuo stesso ruolo.");
        run("UPDATE users SET role = ? WHERE id = ?", role, userId);
        audit(user.id, "admin.set_role", userId, { role }, ip);
        return jsonOk({ userId, role });
      }

      case "set_status": {
        const userId = String(body.userId ?? "");
        const status = body.status === "suspended" ? "suspended" : "active";
        if (userId === user.id) return jsonError("Non puoi sospendere il tuo account.");
        run("UPDATE users SET status = ? WHERE id = ?", status, userId);
        if (status === "suspended") run("UPDATE sessions SET revoked = 1 WHERE user_id = ?", userId);
        audit(user.id, "admin.set_status", userId, { status }, ip);
        return jsonOk({ userId, status });
      }

      case "set_plan_price": {
        const planId = String(body.planId ?? "");
        const priceCents = numberFrom(body.priceCents, Number.NaN, 0, 10_000_00);
        if (!planId || Number.isNaN(priceCents)) return jsonError("planId o prezzo non validi.");
        updatePlanPricing(planId, priceCents, user.id);
        return jsonOk({ planId, priceCents });
      }

      case "grant_live": {
        const userId = String(body.userId ?? "");
        if (!userId) return jsonError("userId obbligatorio.");
        if (body.confirm !== true) return jsonError("Serve una conferma esplicita per autorizzare il live trading.");
        const authorization = grantLiveAuthorization(user.id, userId, {
          maxOrderQuote: numberFrom(body.maxOrderQuote, 100, 0, 1_000_000),
          maxDailyLossQuote: numberFrom(body.maxDailyLossQuote, 25, 0, 1_000_000),
          note: body.note === undefined ? undefined : String(body.note).slice(0, 300),
        });
        return jsonOk({ authorization });
      }

      case "revoke_live": {
        const userId = String(body.userId ?? "");
        if (!userId) return jsonError("userId obbligatorio.");
        revokeLiveAuthorization(user.id, userId);
        return jsonOk({ userId, revoked: true });
      }

      case "upsert_referral": {
        // Trimmed before the lookup: a whitespace-only id is truthy but matches no
        // stored row, so it used to create a referral with a blank primary key.
        const wantedId = typeof body.id === "string" ? body.id.trim() : "";
        const id = wantedId || newId("ref");
        // The upsert replaces every column, so the stored row is read first and the
        // request only overrides what it mentions: a partial update must never
        // clear verification flags or re-enable an offer that was switched off.
        const existing = one<ExistingReferral>("SELECT * FROM referrals WHERE id = ?", id);
        const merged = mergeReferralInput(body, existing);
        if (!merged.ok) return jsonError(merged.error);
        const row = merged.row;

        // A link already in the catalogue is never duplicated and never overwritten.
        // Compared on the normalised form: an equivalent URL written differently
        // must still be caught. Skipped when the update leaves the stored link as is.
        if (merged.urlChanged) {
          const duplicate = findDuplicateReferral(all<{ id: string; name: string; url: string }>("SELECT id, name, url FROM referrals"), id, row.url);
          if (duplicate) {
            return jsonError(`Link già presente in questo Affiliate Center: « ${duplicate.name} ». Nessuna voce esistente è stata modificata.`);
          }
        }

        run(
          `INSERT INTO referrals(id, platform, name, url, category, tagline, description, how_it_works, tutorial, terms, rewards, verified, affiliate_confirmed, accent, active, sort, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             platform = excluded.platform, name = excluded.name, url = excluded.url, category = excluded.category,
             tagline = excluded.tagline,
             description = excluded.description, how_it_works = excluded.how_it_works, tutorial = excluded.tutorial,
             terms = excluded.terms, rewards = excluded.rewards, verified = excluded.verified,
             affiliate_confirmed = excluded.affiliate_confirmed, accent = excluded.accent, active = excluded.active,
             sort = excluded.sort, updated_at = excluded.updated_at`,
          id,
          row.platform,
          row.name,
          row.url,
          row.category,
          row.tagline,
          row.description,
          row.howItWorks,
          row.tutorial,
          row.terms,
          row.rewards,
          row.verified,
          row.affiliateConfirmed,
          row.accent,
          row.active,
          row.sort,
          new Date().toISOString(),
        );
        audit(user.id, "admin.upsert_referral", id, { platform: row.platform, name: row.name, category: row.category }, ip);
        return jsonOk({ id });
      }

      case "delete_referral": {
        const id = String(body.id ?? "");
        if (!id) return jsonError("id obbligatorio.");
        run("DELETE FROM referrals WHERE id = ?", id);
        audit(user.id, "admin.delete_referral", id, null, ip);
        return jsonOk({ deleted: id });
      }

      default:
        return jsonError("Azione non riconosciuta.");
    }
  } catch (err) {
    return jsonError((err as Error).message, 400);
  }
}
