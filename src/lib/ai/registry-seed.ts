/**
 * Registry seed for Stage C.
 *
 * Only OpenRouter's pinned free variant is APPROVED_FREE, and only for PUBLIC
 * data. Every fact below was checked against official sources on the review date;
 * when any of them changes, the record must move to REVIEW_REQUIRED and the
 * adapter must stop receiving tasks.
 */
import type { ProviderRecord } from "./types";

export const OPENROUTER_EVIDENCE = {
  providerId: "openrouter",
  provider: "OpenRouter",
  /** Pinned chat variant with zero price on every pricing field. */
  modelId: "cohere/north-mini-code:free",
  modelRevision: "north-mini-code-20260617",
  checkedAt: "2026-11-05T00:00:00.000Z",
  /** Official sources actually read on the review date. */
  pricingUrl: "https://openrouter.ai/docs/api_reference/limits",
  freeVariantUrl: "https://openrouter.ai/docs/guides/routing/model-variants/free",
  catalogueUrl: "https://openrouter.ai/api/v1/models?output_modalities=all",
  dataPolicyUrl: "https://openrouter.ai/docs/faq",
  /** Documented limits for accounts that never purchased credits. */
  requestsPerMinute: 20,
  requestsPerDay: 50,
  contextTokens: 256_000,
  maxInputTokens: 16_000,
  maxOutputTokens: 4_096,
  notes: [
    "La variante :free ha prezzo 0 su prompt/completion/request nel catalogo pubblico: nessun addebito per richiesta riuscita.",
    "I fallback elencati in `models` verso modelli pagati vengono fatturati: l'adapter non invia mai `models` e imposta allow_fallbacks=false.",
    "Il superamento dei limiti produce 429, non un addebito; un saldo negativo produce 402 anche sui modelli gratuiti.",
    "Con meno di 10 crediti acquistati il limite è 20 richieste/minuto e 50/giorno; l'adapter usa 18/minuto e 50/giorno come tetto.",
    "L'adapter invia data_collection=deny: se nessun endpoint gratuito soddisfa il requisito la richiesta fallisce, non ripiega su un provider che raccoglie dati.",
    "Il catalogo pubblico del 2026-11-05 elenca la variante con pricing prompt/completion a 0, contesto 256000 e parametri tools abilitati.",
  ],
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * APPROVED_FREE for PUBLIC data only. `internalDataApproved` stays false: the
 * free endpoints are third-party and their training policy is not reviewed per
 * endpoint, so INTERNAL work must stay on a local model.
 */
export function approvedOpenRouterRecord(now = Date.now()): ProviderRecord {
  const checkedAt = Date.parse(OPENROUTER_EVIDENCE.checkedAt);
  return {
    providerId: OPENROUTER_EVIDENCE.providerId,
    modelId: OPENROUTER_EVIDENCE.modelId,
    version: OPENROUTER_EVIDENCE.modelRevision,
    state: "APPROVED_FREE",
    billing: "FREE_NO_CARD",
    costPerRequestEur: 0,
    monthlyFixedCostEur: 0,
    requiresPaymentCard: false,
    automaticPaidUpgrade: false,
    trainsOnFreeTier: false,
    internalDataApproved: false,
    localModel: false,
    limits: {
      requestsPerDay: OPENROUTER_EVIDENCE.requestsPerDay,
      maxInputTokens: OPENROUTER_EVIDENCE.maxInputTokens,
      maxOutputTokens: OPENROUTER_EVIDENCE.maxOutputTokens,
    },
    capabilities: {
      contextTokens: OPENROUTER_EVIDENCE.contextTokens,
      tools: true,
      structuredOutput: false,
    },
    officialPricingUrl: OPENROUTER_EVIDENCE.pricingUrl,
    pricingCheckedAt: new Date(Number.isFinite(checkedAt) ? checkedAt : now - DAY_MS).toISOString(),
    health: "ok",
  };
}

/**
 * The free router is deliberately NOT approved: its composition can change
 * without a record revision, so it stays pending until the owner reviews it.
 */
export function pendingOpenRouterRouterRecord(): ProviderRecord {
  return {
    ...approvedOpenRouterRecord(),
    modelId: "openrouter/free",
    version: "free-router-2026-11",
    state: "PENDING_REVIEW",
    officialPricingUrl: OPENROUTER_EVIDENCE.freeVariantUrl,
  };
}
