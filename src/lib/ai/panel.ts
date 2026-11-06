/**
 * Pure presentation logic for the admin AI panel.
 *
 * No React, no I/O: the server page and the client form both consume these
 * functions, and the tests can exercise status labels and error mapping without
 * a browser or a network. Error messages are fixed here on purpose: a provider
 * detail, a key or an internal stack trace must never reach the panel.
 */
import { ROUTE_LIMITS } from "./policy";
import { OPENROUTER_EVIDENCE } from "./registry-seed";
import type { GatewayAttempt } from "./types";

export type PanelState = "disabled" | "active" | "quota";

export type PanelStatusInput = {
  enabled: boolean;
  reason: string;
  used: number;
  limit: number;
  /** GM_AI_SHARED_DB declared: the SQLite quota is global only across one file. */
  sharedDb: boolean;
  production: boolean;
  providerId?: string | null;
  modelId?: string | null;
};

export type PanelStatus = {
  state: PanelState;
  label: string;
  detail: string;
  providerId: string;
  modelId: string;
  freeOnly: true;
  dailyLimit: number;
  used: number;
  remaining: number;
  sharedDb: boolean;
  production: boolean;
  warnings: string[];
};

const clampCount = (value: number, max: number): number =>
  Number.isFinite(value) ? Math.min(Math.max(0, Math.floor(value)), max) : 0;

export function buildPanelStatus(input: PanelStatusInput): PanelStatus {
  const limit =
    Number.isFinite(input.limit) && input.limit > 0 ? Math.floor(input.limit) : ROUTE_LIMITS.perUserPerDay;
  const used = clampCount(input.used, limit);
  const warnings: string[] = [];

  if (!input.sharedDb) {
    warnings.push(
      "GM_AI_SHARED_DB non è dichiarato: il limite SQLite è globale solo se tutte le istanze aprono lo stesso file persistente.",
    );
  }
  if (!input.enabled && input.reason.trim() !== "") warnings.push(input.reason);

  const quotaExhausted = input.enabled && used >= limit;
  const state: PanelState = !input.enabled ? "disabled" : quotaExhausted ? "quota" : "active";

  return {
    state,
    label: state === "disabled" ? "Disattivato" : state === "quota" ? "Quota esaurita" : "Attivo",
    detail:
      state === "disabled"
        ? "Nessuna richiesta viene inviata: manca l'opt-in esplicito o una configurazione valida."
        : state === "quota"
          ? "Il budget giornaliero di questo account è esaurito: la route risponderebbe 429."
          : "Solo variante :free approvata, dati PUBLIC, un tentativo per richiesta.",
    providerId: input.providerId ?? OPENROUTER_EVIDENCE.providerId,
    modelId: input.modelId ?? OPENROUTER_EVIDENCE.modelId,
    freeOnly: true,
    dailyLimit: limit,
    used,
    remaining: Math.max(0, limit - used),
    sharedDb: input.sharedDb,
    production: input.production,
    warnings,
  };
}

export type PanelAttempt = Pick<GatewayAttempt, "providerId" | "modelId" | "outcome" | "durationMs"> & {
  usage?: GatewayAttempt["usage"];
};

export type PanelOutcome =
  | { ok: true; text: string; providerId: string | null; modelId: string | null; attempts: PanelAttempt[] }
  | { ok: false; status: number; message: string; code: string | null };

/** Fixed, user-facing messages. Provider detail is never forwarded. */
const SAFE_MESSAGES: Record<number, string> = {
  400: "Richiesta non valida: controlla obiettivo, prompt e attestazione PUBLIC.",
  401: "Sessione scaduta: accedi di nuovo.",
  403: "Permesso negato: il pannello AI è riservato all'amministratore.",
  413: "Prompt troppo lungo: riduci il testo prima di inviare.",
  422: "Nessun modello gratuito approvato disponibile.",
  429: "Limite o budget esaurito: riprova più tardi.",
  502: "Il provider ha restituito una risposta non valida.",
  503: "AI non attiva o provider non disponibile in questo momento.",
  504: "Il provider non ha risposto entro il tempo massimo.",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function safeAttempts(value: unknown): PanelAttempt[] {
  if (!Array.isArray(value)) return [];
  const attempts: PanelAttempt[] = [];
  for (const item of value.slice(0, 3)) {
    if (!isRecord(item)) continue;
    if (typeof item.providerId !== "string" || typeof item.modelId !== "string") continue;
    if (typeof item.outcome !== "string" || typeof item.durationMs !== "number") continue;
    const attempt: PanelAttempt = {
      providerId: item.providerId,
      modelId: item.modelId,
      outcome: item.outcome as PanelAttempt["outcome"],
      durationMs: item.durationMs,
    };
    const usage = item.usage;
    if (
      isRecord(usage) &&
      typeof usage.inputTokens === "number" &&
      typeof usage.outputTokens === "number"
    ) {
      attempt.usage = { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens };
    }
    attempts.push(attempt);
  }
  return attempts;
}

/**
 * Map an HTTP response from `POST /api/ai` to what the panel may show. Only the
 * answer text, the provider/model of a completed attempt and a fixed message are
 * forwarded: `error` and `detail` from the body are deliberately ignored.
 */
export function panelResultFrom(status: number, body: unknown): PanelOutcome {
  if (status === 200) {
    if (!isRecord(body) || body.ok !== true || typeof body.text !== "string" || body.text.trim() === "") {
      return { ok: false, status: 502, message: SAFE_MESSAGES[502], code: null };
    }
    return {
      ok: true,
      text: body.text,
      providerId: typeof body.providerId === "string" ? body.providerId : null,
      modelId: typeof body.modelId === "string" ? body.modelId : null,
      attempts: safeAttempts(body.attempts),
    };
  }

  const code =
    isRecord(body) && typeof body.code === "string" && /^[A-Z_]{3,40}$/.test(body.code) ? body.code : null;
  const message = SAFE_MESSAGES[status] ?? "Richiesta non eseguita.";
  return { ok: false, status, message, code };
}
