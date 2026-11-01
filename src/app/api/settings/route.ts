import { jsonError, jsonOk, numberFrom } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientMeta, currentUser } from "@/lib/auth";
import { crossSite } from "@/lib/api";
import { QUOTES, type EngineSettings } from "@/lib/config";
import { saveBranding, saveSettings, saveUserSettings } from "@/lib/db";
import { saveNetworkFee } from "@/lib/network-fees";
import { rateLimit } from "@/lib/rate-limit";
import { run } from "@/lib/db";

export async function PATCH(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError("Autenticazione richiesta.", 401);
  if (crossSite(req)) return jsonError("Richiesta cross-site bloccata.", 403);
  const { ip } = await clientMeta();
  if (!rateLimit(`settings:${user.id}`, 20, 60_000).ok) return jsonError("Troppe modifiche. Attendi un minuto.", 429);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError("Richiesta non valida.");
  }

  const patch: Partial<EngineSettings> = {};

  if (body.minMarginPct !== undefined) patch.minMarginPct = numberFrom(body.minMarginPct, 0.35, 0, 50);
  if (body.notionalQuote !== undefined) patch.notionalQuote = numberFrom(body.notionalQuote, 500, 10, 1_000_000);
  if (body.maxSlippagePct !== undefined) patch.maxSlippagePct = numberFrom(body.maxSlippagePct, 0.6, 0, 10);
  if (body.safetyBufferPct !== undefined) patch.safetyBufferPct = numberFrom(body.safetyBufferPct, 0.05, 0, 5);
  if (body.candidateSpreadPct !== undefined) patch.candidateSpreadPct = numberFrom(body.candidateSpreadPct, 0.1, 0, 10);
  if (body.maxDataAgeMs !== undefined) patch.maxDataAgeMs = numberFrom(body.maxDataAgeMs, 20000, 500, 300_000);
  if (body.maxOrderQuote !== undefined) patch.maxOrderQuote = numberFrom(body.maxOrderQuote, 1000, 0, 1_000_000);
  if (body.maxDailyLossQuote !== undefined) patch.maxDailyLossQuote = numberFrom(body.maxDailyLossQuote, 50, 0, 1_000_000);
  if (body.maxOrdersPerHour !== undefined) patch.maxOrdersPerHour = numberFrom(body.maxOrdersPerHour, 10, 0, 1000);
  if (body.transferMode !== undefined) {
    patch.transferMode = body.transferMode === "transfer" ? "transfer" : "prefunded";
  }
  if (body.quote !== undefined) {
    const q = String(body.quote).toUpperCase();
    if (!(QUOTES as readonly string[]).includes(q)) return jsonError("Valuta di quotazione non supportata.");
    patch.quote = q as EngineSettings["quote"];
  }
  for (const key of ["monitoringEnabled", "paperAutoFollow"] as const) {
    if (body[key] !== undefined) patch[key] = Boolean(body[key]);
  }
  // Live trading switch is admin-only: a client can never enable it on themselves.
  if (body.liveTradingEnabled !== undefined) {
    if (user.role !== "admin") return jsonError("Solo l'amministratore può abilitare il live trading.", 403);
    patch.liveTradingEnabled = Boolean(body.liveTradingEnabled);
  }

  const next = saveUserSettings(user.id, patch);

  // Network fees (withdrawal cost per asset)
  if (body.networkFees && typeof body.networkFees === "object") {
    for (const [asset, raw] of Object.entries(body.networkFees as Record<string, unknown>)) {
      const value = raw === null || raw === "" ? null : numberFrom(raw, Number.NaN, 0);
      if (Number.isNaN(value)) continue;
      saveNetworkFee(asset, value, `input manuale (${user.email})`);
    }
    audit(user.id, "settings.network_fees", null, body.networkFees, ip);
  }

  // Branding: white-label for the tenant, global branding for admins
  if (body.brandName !== undefined || body.brandAccent !== undefined) {
    const brandName = body.brandName === undefined ? undefined : String(body.brandName).slice(0, 60) || null;
    const brandAccent = body.brandAccent === undefined ? undefined : String(body.brandAccent).slice(0, 32) || null;
    run(
      "UPDATE users SET brand_name = COALESCE(?, brand_name), brand_accent = COALESCE(?, brand_accent) WHERE id = ?",
      brandName ?? null,
      brandAccent ?? null,
      user.id,
    );
    audit(user.id, "settings.branding.user", user.id, { brandName, brandAccent }, ip);
  }
  if (body.globalBranding && user.role === "admin") {
    const g = body.globalBranding as Record<string, unknown>;
    const saved = saveBranding({
      appName: g.appName === undefined ? undefined : String(g.appName).slice(0, 60),
      logoMark: g.logoMark === undefined ? undefined : String(g.logoMark).slice(0, 4),
      accent: g.accent === undefined ? undefined : String(g.accent).slice(0, 32),
      tagline: g.tagline === undefined ? undefined : String(g.tagline).slice(0, 80),
      footer: g.footer === undefined ? undefined : String(g.footer).slice(0, 200),
    });
    if (g.applyGlobally === true) saveSettings({});
    audit(user.id, "settings.branding.global", "branding", saved, ip);
  }

  audit(user.id, "settings.update", user.id, patch, ip);
  return jsonOk({ settings: next });
}
