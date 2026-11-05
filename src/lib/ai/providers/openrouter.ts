/**
 * OpenRouter adapter — the first (and only) real provider, Stage C.
 *
 * Cost safety is enforced by construction, not by configuration:
 * - only a pinned model id ending in `:free` is accepted;
 * - the request never carries a `models` fallback array (OpenRouter bills those);
 * - `allow_fallbacks: false` and a local per-minute limiter bound the traffic;
 * - every response is validated before its text is used.
 *
 * Evidence for the approved record lives in ../registry-seed.ts and
 * docs/GM_AI_STAGE_C.md. This module is server-only: it is imported by no client
 * component and reads its key from the environment, never from arguments in the
 * browser.
 */
import { redact } from "../redact";
import type { AdapterRequest, AdapterResult, FailureCode, ProviderAdapter, ProviderRecord } from "../types";

export const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/** Documented free-model ceiling is 20 requests/minute: keep a safety margin. */
export const OPENROUTER_MINUTE_LIMIT = 18;
export const OPENROUTER_MAX_RESPONSE_BYTES = 1_000_000;

const FREE_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*:free$/;

export function isFreeModelId(modelId: string): boolean {
  return FREE_MODEL_PATTERN.test(modelId);
}

export type OpenRouterConfig = {
  apiKey: string;
  /** Pinned free variant; must end with `:free`. */
  modelId: string;
  maxOutputTokens: number;
  minuteLimit?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type OpenRouterConfigResult =
  | { ok: true; config: OpenRouterConfig }
  | { ok: false; reason: string };

/** Opt-in, explicit and fail-closed: no key, no free model, no adapter. */
export function parseOpenRouterConfig(env: Record<string, string | undefined>): OpenRouterConfigResult {
  const enabled = (env.GM_AI_OPENROUTER ?? "").trim().toLowerCase();
  if (enabled !== "true") {
    return { ok: false, reason: "adapter disattivato: GM_AI_OPENROUTER non è 'true'" };
  }

  const apiKey = (env.OPENROUTER_API_KEY ?? "").trim();
  if (apiKey.length < 20) {
    return { ok: false, reason: "OPENROUTER_API_KEY assente o troppo corta" };
  }

  const modelId = (env.GM_AI_OPENROUTER_MODEL ?? "").trim();
  if (!isFreeModelId(modelId)) {
    return { ok: false, reason: "GM_AI_OPENROUTER_MODEL deve essere una variante :free verificata" };
  }

  return { ok: true, config: { apiKey, modelId, maxOutputTokens: 4_096 } };
}

type RawCompletion = {
  model?: unknown;
  choices?: unknown;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

export function createOpenRouterAdapter(config: OpenRouterConfig): ProviderAdapter {
  if (!isFreeModelId(config.modelId)) {
    throw new Error("OpenRouter adapter richiede un modello :free verificato");
  }

  const fetchImpl: typeof fetch = config.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = config.now ?? (() => Date.now());
  const minuteLimit = Math.max(1, config.minuteLimit ?? OPENROUTER_MINUTE_LIMIT);
  let recentCalls: number[] = [];

  const sanitize = (text: string): string => {
    const withoutKey = config.apiKey.length > 0 ? text.split(config.apiKey).join("[redacted-key]") : text;
    return redact(withoutKey).slice(0, 300);
  };

  const allowThisMinute = (): boolean => {
    const current = now();
    recentCalls = recentCalls.filter((ts) => current - ts < 60_000);
    if (recentCalls.length >= minuteLimit) return false;
    recentCalls.push(current);
    return true;
  };

  return async (request: AdapterRequest, signal: AbortSignal): Promise<AdapterResult> => {
    const { provider, prompt } = request;

    if (provider.providerId !== "openrouter") {
      return fail("MODEL_NOT_APPROVED", "adapter OpenRouter invocato per un provider diverso");
    }
    if (provider.modelId !== config.modelId) {
      return fail("MODEL_NOT_APPROVED", "il record approvato non corrisponde al modello configurato");
    }

    const estimatedInputTokens = Math.ceil(prompt.length / 4);
    if (estimatedInputTokens > provider.limits.maxInputTokens) {
      return fail(
        "TASK_BUDGET_EXCEEDED",
        `prompt stimato ${estimatedInputTokens} token, oltre il limite ${provider.limits.maxInputTokens}`,
      );
    }

    const maxTokens = Math.min(config.maxOutputTokens, provider.limits.maxOutputTokens);
    if (maxTokens < 1) return fail("TASK_BUDGET_EXCEEDED", "limite di output non valido");

    if (!allowThisMinute()) {
      return {
        ok: false,
        code: "RATE_LIMITED",
        retryAfterMs: 60_000,
        detail: `limite locale di ${minuteLimit} richieste/minuto raggiunto`,
      };
    }

    const body = {
      model: config.modelId,
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      temperature: 0,
      usage: { include: true },
      // No `models` array: OpenRouter bills a paid fallback listed there.
      provider: { allow_fallbacks: false, data_collection: "deny" },
    };

    let response: Response;
    try {
      response = await fetchImpl(OPENROUTER_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "GM Crypto Ecosystem",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) return { ok: false, code: "TIMEOUT", detail: "richiesta annullata o scaduta" };
      return { ok: false, code: "PROVIDER_UNAVAILABLE", detail: `rete: ${sanitize(errorMessage(error))}` };
    }

    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    const raw = await safeText(response);
    if (raw.length > OPENROUTER_MAX_RESPONSE_BYTES) {
      return fail("INVALID_RESPONSE", "risposta oltre il limite di dimensione");
    }

    // 402 is the billing signal, including "negative balance" on free models.
    if (response.status === 402) {
      return { ok: false, code: "BILLING_REQUIRED", detail: sanitize(raw) || "OpenRouter richiede credito" };
    }
    if (response.status === 429) {
      const detail = sanitize(raw) || "limite di richieste OpenRouter raggiunto";
      return retryAfterMs
        ? { ok: false, code: "RATE_LIMITED", retryAfterMs, detail }
        : { ok: false, code: "RATE_LIMITED", detail };
    }
    if (response.status === 401 || response.status === 403) {
      return fail("PROVIDER_UNAVAILABLE", `autenticazione rifiutata (HTTP ${response.status})`);
    }
    if (response.status === 404) {
      return fail("MODEL_NOT_APPROVED", "variante :free non disponibile (HTTP 404)");
    }
    if (response.status >= 500) {
      return fail("PROVIDER_UNAVAILABLE", `HTTP ${response.status}`);
    }
    if (response.status !== 200) {
      return fail("INVALID_RESPONSE", `HTTP ${response.status}`);
    }

    return parseCompletion(raw, config.modelId);
  };
}

function fail(code: FailureCode, detail: string): AdapterResult {
  return { ok: false, code, detail };
}

function parseCompletion(raw: string, modelId: string): AdapterResult {
  let payload: RawCompletion;
  try {
    payload = JSON.parse(raw) as RawCompletion;
  } catch {
    return fail("INVALID_RESPONSE", "JSON non valido");
  }

  if (typeof payload.model === "string" && payload.model !== modelId && !payload.model.endsWith(":free")) {
    return fail("INVALID_RESPONSE", "la risposta proviene da un modello diverso dalla variante :free approvata");
  }

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    return fail("INVALID_RESPONSE", "risposta senza contenuto testuale");
  }

  const inputTokens = payload.usage?.prompt_tokens;
  const outputTokens = payload.usage?.completion_tokens;
  if (typeof inputTokens === "number" && typeof outputTokens === "number" && inputTokens >= 0 && outputTokens >= 0) {
    return { ok: true, text: content, usage: { inputTokens, outputTokens } };
  }
  return { ok: true, text: content };
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value.trim())) return undefined;
  const seconds = Number(value);
  return Math.min(seconds * 1000, 60 * 60 * 1000);
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function isAbortError(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  const code = (error as { code?: unknown })?.code;
  return name === "AbortError" || code === "ABORT_ERR";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "errore sconosciuto";
}
