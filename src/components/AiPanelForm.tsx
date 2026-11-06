"use client";

import { useState } from "react";
import { panelResultFrom, type PanelOutcome } from "@/lib/ai/panel";
import { Icon } from "./icons";

const MAX_OBJECTIVE = 500;
const MAX_PROMPT = 64_000;

/**
 * Admin form for `POST /api/ai`.
 *
 * Deliberate constraints:
 * - the attestation checkbox starts unchecked and is required for every send;
 * - only `objective`, `prompt` and `attestPublicData` are transmitted;
 * - no prompt, answer or attestation is written to localStorage, sessionStorage,
 *   cookies, the URL or the console;
 * - nothing is sent on mount or by a timer: only the submit handler sends.
 */
export default function AiPanelForm() {
  const [objective, setObjective] = useState("");
  const [prompt, setPrompt] = useState("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<PanelOutcome | null>(null);

  const canSend = attested && objective.trim() !== "" && prompt.trim() !== "" && !busy;

  const send = async () => {
    if (!canSend) return;
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          objective: objective.trim(),
          prompt: prompt.trim(),
          attestPublicData: true,
        }),
      });
      const body: unknown = await res.json().catch(() => null);
      setOutcome(panelResultFrom(res.status, body));
    } catch {
      setOutcome({ ok: false, status: 0, message: "Errore di rete: la richiesta non è stata inviata.", code: null });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setObjective("");
    setPrompt("");
    setAttested(false);
    setOutcome(null);
  };

  return (
    <div className="space-y-3 px-4 py-4">
      <div className="grid gap-3 lg:grid-cols-[1fr,1.6fr]">
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Obiettivo</span>
          <input
            className="gm-input"
            value={objective}
            onChange={(event) => setObjective(event.target.value)}
            maxLength={MAX_OBJECTIVE}
            placeholder="Es. Riassumi questo testo pubblico"
            disabled={busy}
          />
          <span className="mt-1 block text-right text-[10px] text-muted">
            {objective.length}/{MAX_OBJECTIVE}
          </span>
        </label>

        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">Prompt</span>
          <textarea
            className="gm-input min-h-[132px] resize-y font-mono text-[12px] leading-relaxed"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            maxLength={MAX_PROMPT}
            placeholder="Incolla solo testo pubblico. Nessun dato finanziario interno, personale o riservato."
            disabled={busy}
          />
          <span className="mt-1 block text-right text-[10px] text-muted">
            {prompt.length}/{MAX_PROMPT}
          </span>
        </label>
      </div>

      <label className="flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed" style={{ borderColor: "var(--color-line)" }}>
        <input
          type="checkbox"
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]"
          checked={attested}
          onChange={(event) => setAttested(event.target.checked)}
          disabled={busy}
        />
        <span className="text-muted">
          Confermo che il testo è <strong className="text-paper">pubblico</strong> e che non contiene dati INTERNAL, CONFIDENTIAL o
          SECRET, credenziali, chiavi API, dati personali o informazioni finanziarie interne. Questa conferma viene registrata con il
          mio account e il task; non è un controllo automatico del contenuto.
        </span>
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="gm-btn-accent" onClick={send} disabled={!canSend}>
          <Icon name="bolt" size={15} />
          {busy ? "Invio in corso…" : "Invia al modello gratuito"}
        </button>
        <button type="button" className="gm-btn-ghost" onClick={reset} disabled={busy}>
          Pulisci
        </button>
        <span className="text-[10px] leading-snug text-muted">
          {attested ? "Un tentativo per richiesta · nessun fallback a pagamento" : "L'invio resta disabilitato finché non attesti i dati PUBLIC."}
        </span>
      </div>

      <div aria-live="polite">
        {outcome === null ? (
          <p className="text-[11px] leading-relaxed text-muted">
            La pagina non invia nulla da sola: nessuna richiesta parte al caricamento o dopo un timeout. Se l&apos;AI è disattivata
            riceverai 503 senza che alcun testo lasci l&apos;host.
          </p>
        ) : outcome.ok ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span className="gm-badge gm-badge-pos">risposta</span>
              {outcome.providerId ? <span>{outcome.providerId}</span> : null}
              {outcome.modelId ? <span>· {outcome.modelId}</span> : null}
              {outcome.attempts[0] ? <span>· {outcome.attempts[0].durationMs} ms</span> : null}
            </div>
            <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border bg-white/[0.02] px-3 py-2.5 text-[12px] leading-relaxed text-paper" style={{ borderColor: "var(--color-line)" }}>
              {outcome.text}
            </pre>
          </div>
        ) : (
          <div className="rounded-xl border px-3 py-2.5 text-[12px] leading-relaxed" style={{ borderColor: "rgba(255,107,107,0.3)", background: "rgba(255,107,107,0.07)" }}>
            <div className="font-semibold text-neg">Richiesta non eseguita</div>
            <div className="mt-0.5 text-muted">{outcome.message}</div>
            <div className="mt-1 text-[10px] text-[#6f6f7b]">
              HTTP {outcome.status}
              {outcome.code ? ` · ${outcome.code}` : ""}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
