/**
 * Test fixtures for the free-only gateway.
 *
 * These records are deliberately illustrative: they encode the free-tier facts
 * that must be re-verified against official pages before approval (see
 * docs/GM_AI_COLLECTIVE_FREE_ONLY.md, section 2). No provider is contacted.
 */
import type { AdapterRequest, AdapterResult, ProviderAdapter, ProviderRecord } from "../types";

const DAY_MS = 24 * 60 * 60 * 1000;

const checkedAt = (now: number) => new Date(now - 2 * DAY_MS).toISOString();

export function defaultRegistry(now = Date.now()): ProviderRecord[] {
  const evidenceDate = checkedAt(now);

  return [
    {
      providerId: "openrouter",
      modelId: "openrouter/free",
      version: "free-router-2026-11",
      state: "APPROVED_FREE",
      billing: "FREE_NO_CARD",
      costPerRequestEur: 0,
      monthlyFixedCostEur: 0,
      requiresPaymentCard: false,
      automaticPaidUpgrade: false,
      trainsOnFreeTier: false,
      internalDataApproved: true,
      localModel: false,
      limits: { requestsPerDay: 50, maxInputTokens: 16_000, maxOutputTokens: 4_096 },
      capabilities: { contextTokens: 32_768, tools: false, structuredOutput: true },
      officialPricingUrl: "https://openrouter.ai/docs/api_reference/limits",
      pricingCheckedAt: evidenceDate,
      health: "ok",
    },
    {
      providerId: "openrouter-backup",
      modelId: "openrouter/backup-free",
      version: "free-router-2026-11",
      state: "APPROVED_FREE",
      billing: "FREE_NO_CARD",
      costPerRequestEur: 0,
      monthlyFixedCostEur: 0,
      requiresPaymentCard: false,
      automaticPaidUpgrade: false,
      trainsOnFreeTier: false,
      internalDataApproved: false,
      localModel: false,
      limits: { requestsPerDay: 20, maxInputTokens: 8_000, maxOutputTokens: 2_048 },
      capabilities: { contextTokens: 16_384, tools: false, structuredOutput: false },
      officialPricingUrl: "https://openrouter.ai/docs/api_reference/limits",
      pricingCheckedAt: evidenceDate,
      health: "ok",
    },
    {
      providerId: "ollama",
      modelId: "local-8b-q4",
      version: "q4_K_M",
      state: "APPROVED_FREE",
      billing: "FREE_NO_CARD",
      costPerRequestEur: 0,
      monthlyFixedCostEur: 0,
      requiresPaymentCard: false,
      automaticPaidUpgrade: false,
      trainsOnFreeTier: false,
      internalDataApproved: true,
      localModel: true,
      limits: { requestsPerDay: 1_000, maxInputTokens: 8_000, maxOutputTokens: 2_048 },
      capabilities: { contextTokens: 8_192, tools: false, structuredOutput: false },
      officialPricingUrl: "https://ollama.com/library",
      pricingCheckedAt: evidenceDate,
      health: "unknown",
    },
    {
      providerId: "gemini",
      modelId: "gemini-3-flash",
      version: "preview",
      state: "PENDING_REVIEW",
      // Google documents free-tier input as usable to improve its products, and the
      // quota is too small for coding work: pending review, never "free" by default.
      billing: "UNKNOWN",
      costPerRequestEur: 0,
      monthlyFixedCostEur: 0,
      requiresPaymentCard: false,
      automaticPaidUpgrade: false,
      trainsOnFreeTier: true,
      internalDataApproved: false,
      localModel: false,
      limits: { requestsPerDay: 20, maxInputTokens: 32_000, maxOutputTokens: 8_192 },
      capabilities: { contextTokens: 1_000_000, tools: true, structuredOutput: true },
      officialPricingUrl: "https://ai.google.dev/gemini-api/docs/pricing",
      pricingCheckedAt: evidenceDate,
      health: "unknown",
    },
    {
      providerId: "huggingface",
      modelId: "hf-inference",
      version: "n/a",
      state: "REJECTED",
      // Free accounts carry no monthly inference credits: credits must be purchased.
      billing: "FREE_CARD_REQUIRED",
      costPerRequestEur: 0,
      monthlyFixedCostEur: 0,
      requiresPaymentCard: true,
      automaticPaidUpgrade: true,
      trainsOnFreeTier: false,
      internalDataApproved: false,
      localModel: false,
      limits: { requestsPerDay: 1, maxInputTokens: 4_000, maxOutputTokens: 1_000 },
      capabilities: { contextTokens: 8_192, tools: false, structuredOutput: false },
      officialPricingUrl: "https://huggingface.co/docs/inference-providers/en/pricing",
      pricingCheckedAt: evidenceDate,
      health: "unknown",
    },
    {
      providerId: "paid-frontier",
      modelId: "paid-frontier-large",
      version: "2026-10",
      state: "APPROVED_FREE",
      // Contradictory on purpose: a paid record must still never be selected.
      billing: "PAID",
      costPerRequestEur: 0.02,
      monthlyFixedCostEur: 0,
      requiresPaymentCard: true,
      automaticPaidUpgrade: false,
      trainsOnFreeTier: false,
      internalDataApproved: true,
      localModel: false,
      limits: { requestsPerDay: 10_000, maxInputTokens: 128_000, maxOutputTokens: 16_384 },
      capabilities: { contextTokens: 200_000, tools: true, structuredOutput: true },
      officialPricingUrl: "https://openrouter.ai/pricing",
      pricingCheckedAt: evidenceDate,
      health: "ok",
    },
  ];
}

export function providerById(registry: readonly ProviderRecord[], providerId: string): ProviderRecord {
  const found = registry.find((provider) => provider.providerId === providerId);
  if (!found) throw new Error(`provider ${providerId} assente dal registry di test`);
  return found;
}

export type MockAdapter = ProviderAdapter & { calls: AdapterRequest[] };

/** Deterministic adapter that records every call for assertions. */
export function mockAdapter(handler: (request: AdapterRequest) => AdapterResult | Promise<AdapterResult>): MockAdapter {
  const calls: AdapterRequest[] = [];
  const adapter = async (request: AdapterRequest): Promise<AdapterResult> => {
    calls.push(request);
    return await handler(request);
  };
  return Object.assign(adapter, { calls });
}

export const okText = (text = "risposta simulata"): AdapterResult => ({ ok: true, text });
