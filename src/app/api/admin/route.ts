import { guardedMutation, jsonError, jsonOk, numberFrom } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientMeta } from "@/lib/auth";
import { newId } from "@/lib/crypto";
import { run } from "@/lib/db";
import { grantLiveAuthorization, revokeLiveAuthorization } from "@/lib/live";
import { setUserPlan, updatePlanPricing } from "@/lib/plans";

export const runtime = "nodejs";

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
        const id = body.id ? String(body.id) : newId("ref");
        const platform = String(body.platform ?? "").slice(0, 60);
        const name = String(body.name ?? "").slice(0, 80);
        const url = String(body.url ?? "");
        if (!platform || !name || !/^https:\/\//i.test(url)) return jsonError("Piattaforma, nome e URL https sono obbligatori.");
        const tutorial = Array.isArray(body.tutorial) ? (body.tutorial as unknown[]).map((t) => String(t).slice(0, 300)) : [];
        run(
          `INSERT INTO referrals(id, platform, name, url, tagline, description, how_it_works, tutorial, terms, rewards, verified, affiliate_confirmed, accent, active, sort, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET
             platform = excluded.platform, name = excluded.name, url = excluded.url, tagline = excluded.tagline,
             description = excluded.description, how_it_works = excluded.how_it_works, tutorial = excluded.tutorial,
             terms = excluded.terms, rewards = excluded.rewards, verified = excluded.verified,
             affiliate_confirmed = excluded.affiliate_confirmed, accent = excluded.accent, active = excluded.active,
             sort = excluded.sort, updated_at = excluded.updated_at`,
          id,
          platform,
          name,
          url,
          String(body.tagline ?? "").slice(0, 160) || null,
          String(body.description ?? "").slice(0, 1200) || null,
          String(body.howItWorks ?? "").slice(0, 1200) || null,
          JSON.stringify(tutorial),
          String(body.terms ?? "").slice(0, 800) || null,
          String(body.rewards ?? "").slice(0, 300) || null,
          body.verified === true ? 1 : 0,
          body.affiliateConfirmed === true ? 1 : 0,
          String(body.accent ?? "gold").slice(0, 20),
          body.active === false ? 0 : 1,
          numberFrom(body.sort, 100, 0, 9999),
          new Date().toISOString(),
        );
        audit(user.id, "admin.upsert_referral", id, { platform, name }, ip);
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
