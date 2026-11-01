import { audit } from "./audit";
import { all, one, run } from "./db";

export type PlanLimits = {
  venues: number;
  pairs: number;
  scansPerHour: number;
  historyDays: number;
  apiKeys: number;
};

export type PlanRow = {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  interval: string;
  tagline: string | null;
  limits: string;
  features: string;
  active: number;
  payments_configured: number;
  sort: number;
};

const FALLBACK: PlanLimits = { venues: 2, pairs: 3, scansPerHour: 30, historyDays: 7, apiKeys: 0 };

export function listPlans(): PlanRow[] {
  return all<PlanRow>("SELECT * FROM plans ORDER BY sort ASC");
}

export function getPlan(planId: string): PlanRow | null {
  return one<PlanRow>("SELECT * FROM plans WHERE id = ?", planId);
}

export function planLimits(planId: string): PlanLimits {
  const plan = getPlan(planId);
  if (!plan) return FALLBACK;
  try {
    return { ...FALLBACK, ...(JSON.parse(plan.limits) as Partial<PlanLimits>) };
  } catch {
    return FALLBACK;
  }
}

export function planFeatures(planId: string): string[] {
  const plan = getPlan(planId);
  if (!plan) return [];
  try {
    return JSON.parse(plan.features) as string[];
  } catch {
    return [];
  }
}

export function setUserPlan(userId: string, planId: string, actorId: string) {
  if (!getPlan(planId)) throw new Error("Piano inesistente.");
  run("UPDATE users SET plan = ? WHERE id = ?", planId, userId);
  run(
    `INSERT INTO subscriptions(id, user_id, plan_id, status, started_at, note)
     VALUES(?,?,?,?,?,?)`,
    `sub_${Math.random().toString(36).slice(2, 11)}`,
    userId,
    planId,
    planId === "free" ? "active" : "inactive",
    new Date().toISOString(),
    "Assegnazione manuale da amministratore. Pagamenti non configurati.",
  );
  audit(actorId, "plan.assign", userId, { planId }, null);
}

export function updatePlanPricing(planId: string, priceCents: number, actorId: string) {
  run("UPDATE plans SET price_cents = ? WHERE id = ?", Math.max(0, Math.round(priceCents)), planId);
  audit(actorId, "plan.price", planId, { priceCents }, null);
}

/** Payments stay hard-off until a real, verified provider is configured. */
export function paymentsEnabled(): boolean {
  return process.env.GM_PAYMENTS_PROVIDER !== undefined && process.env.GM_PAYMENTS_PROVIDER !== "";
}
