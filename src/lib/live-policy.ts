/**
 * Deterministic pre-trade policy for the future controlled-live execution path.
 * No exchange/network dependencies. This is a guard, not an order router.
 * The actual live path remains hard-disabled in live.ts.
 */
export type ControlledLivePolicy = {
  mode: "controlled";
  quoteCurrency: string;
  maxOrderQuote: number;
  maxDailyLossQuote: number;
  maxExposureQuote: number;
  maxOrdersPerHour: number;
  maxSpreadPct: number;
  maxSlippagePct: number;
  maxBookAgeMs: number;
  allowedSymbols: readonly string[];
};
export type LiveOrderIntent = {
  symbol: string;
  side: "buy" | "sell";
  quoteNotional: number;
  expectedSpreadPct: number;
  expectedSlippagePct: number;
  worstCaseLossAtStopQuote: number;
};
export type LiveRiskSnapshot = {
  liveSwitchEnabled: boolean;
  ownerPolicyAuthorizationActive: boolean;
  finalOwnerApproval: boolean;
  routerImplemented: boolean;
  apiCredentialValid: boolean;
  apiPermission: "read-only" | "trade-only" | "trade-and-withdraw" | "unknown";
  withdrawalsEnabled: boolean;
  killSwitchActive: boolean;
  balanceFresh: boolean;
  dailyRealizedLossQuote: number;
  currentExposureQuote: number;
  ordersLastHour: number;
  orderBookAgeMs: number;
};
export type LivePolicyDecision = {
  allowed: boolean;
  reasons: string[];
  effectiveMaxOrderQuote: number;
  quoteCurrency: string;
};
const nonNegative = (n: number) => Number.isFinite(n) && n >= 0;
const positive = (n: number) => Number.isFinite(n) && n > 0;

/** Fail-closed deterministic policy evaluation. It never submits an order. */
export function evaluateControlledLiveOrder(
  intent: LiveOrderIntent,
  policy: ControlledLivePolicy,
  snapshot: LiveRiskSnapshot,
): LivePolicyDecision {
  const reasons: string[] = [];
  const limits = [policy.maxOrderQuote, policy.maxDailyLossQuote, policy.maxExposureQuote,
    policy.maxOrdersPerHour, policy.maxSpreadPct, policy.maxSlippagePct, policy.maxBookAgeMs];
  if (policy.mode !== "controlled") reasons.push("Modalità live non riconosciuta.");
  if (!policy.quoteCurrency.trim()) reasons.push("Valuta di quotazione non configurata.");
  if (limits.some((n) => !positive(n))) reasons.push("Uno o più limiti preventivi non sono validi.");
  if (!policy.allowedSymbols.length) reasons.push("Nessun mercato autorizzato dalla politica.");
  if (!snapshot.liveSwitchEnabled) reasons.push("Interruttore live disattivato.");
  if (!snapshot.ownerPolicyAuthorizationActive) reasons.push("Politica preventiva non autorizzata dall'amministratore.");
  if (!snapshot.finalOwnerApproval) reasons.push("Autorizzazione finale del proprietario mancante.");
  if (!snapshot.routerImplemented) reasons.push("Order router non implementato/verificato.");
  if (!snapshot.apiCredentialValid) reasons.push("Credenziale Revolut X non verificata.");
  if (snapshot.apiPermission !== "trade-only" || snapshot.withdrawalsEnabled) {
    reasons.push("La credenziale deve consentire solo il trading e non i prelievi.");
  }
  if (snapshot.killSwitchActive) reasons.push("Emergency Stop attivo.");
  if (!snapshot.balanceFresh) reasons.push("Saldo/account non aggiornato.");
  if (!nonNegative(snapshot.dailyRealizedLossQuote) || !nonNegative(snapshot.currentExposureQuote) ||
      !Number.isInteger(snapshot.ordersLastHour) || snapshot.ordersLastHour < 0 ||
      !nonNegative(snapshot.orderBookAgeMs)) reasons.push("Snapshot di rischio incompleto o non valido.");

  if (!intent.symbol || !policy.allowedSymbols.includes(intent.symbol)) reasons.push("Mercato non incluso nella allowlist.");
  if (intent.side !== "buy" && intent.side !== "sell") reasons.push("Direzione ordine non valida.");
  if (!positive(intent.quoteNotional)) reasons.push("Importo ordine non valido.");
  else if (intent.quoteNotional > policy.maxOrderQuote) reasons.push("Importo superiore al limite per ordine.");
  if (!nonNegative(intent.expectedSpreadPct) || intent.expectedSpreadPct > policy.maxSpreadPct) {
    reasons.push("Spread oltre il limite preventivo o non valido.");
  }
  if (!nonNegative(intent.expectedSlippagePct) || intent.expectedSlippagePct > policy.maxSlippagePct) {
    reasons.push("Slippage stimato oltre il limite preventivo o non valido.");
  }
  if (!positive(intent.worstCaseLossAtStopQuote)) reasons.push("Perdita massima stimata non valida: serve uno stop/risk estimate.");
  if (snapshot.dailyRealizedLossQuote + (nonNegative(intent.worstCaseLossAtStopQuote) ? intent.worstCaseLossAtStopQuote : 0) > policy.maxDailyLossQuote) {
    reasons.push("L'ordine supererebbe il limite massimo di perdita giornaliera.");
  }
  if (snapshot.currentExposureQuote + (nonNegative(intent.quoteNotional) ? intent.quoteNotional : 0) > policy.maxExposureQuote) {
    reasons.push("L'ordine supererebbe il limite massimo di esposizione.");
  }
  if (snapshot.ordersLastHour >= policy.maxOrdersPerHour) reasons.push("Numero massimo di ordini nell'ultima ora raggiunto.");
  if (snapshot.orderBookAgeMs > policy.maxBookAgeMs) reasons.push("Order book troppo vecchio.");

  return { allowed: reasons.length === 0, reasons, effectiveMaxOrderQuote: policy.maxOrderQuote, quoteCurrency: policy.quoteCurrency };
}
