"use client";

import { useState } from "react";
import { Icon } from "./icons";
import { cn } from "./ui";

type Msg = { role: "user" | "ai"; text: string; intent?: string; source?: string };

const SUGGESTIONS = [
  "Qual è la migliore opportunità adesso?",
  "Spiegami le commissioni usate nel calcolo",
  "Perché l'ultimo segnale è stato scartato?",
  "Come sta andando il paper trading?",
  "Quali rischi devo considerare?",
  "Kraken e Coinbase espongono API pubbliche?",
];

export default function IntelligenceChat() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "ai",
      text:
        "Sono GM TRADING INTELLIGENCE. Rispondo usando solo i dati registrati dal motore: order book reali, commissioni configurate, esiti e motivi di scarto. Se un dato non esiste, lo dico invece di inventarlo.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/intelligence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; data?: { answer: string; intent: string; source: string }; error?: string };
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: json.ok && json.data ? json.data.answer : json.error ?? "Analisi non disponibile.",
          intent: json.data?.intent,
          source: json.data?.source,
        },
      ]);
    } catch (err) {
      setMessages((m) => [...m, { role: "ai", text: `Errore di rete: ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="max-h-[440px] min-h-[220px] space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[92%] rounded-xl border px-3 py-2 text-[13px] leading-relaxed sm:max-w-[85%]",
                m.role === "user"
                  ? "border-[rgba(212,175,55,0.35)] bg-[rgba(212,175,55,0.1)] text-paper"
                  : "border-[var(--color-line)] bg-white/[0.025] text-muted",
              )}
            >
              {m.role === "ai" ? (
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">
                  <Icon name="brain" size={12} /> GM Intelligence
                  {m.intent ? <span className="text-[#60606b]">· {m.intent}</span> : null}
                </div>
              ) : null}
              <div className="whitespace-pre-wrap">{m.text}</div>
            </div>
          </div>
        ))}
        {busy ? <div className="text-[11px] text-muted">Analisi dei dati registrati…</div> : null}
      </div>

      <div className="border-t px-4 py-3" style={{ borderColor: "var(--color-line)" }}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              disabled={busy}
              className="rounded-full border px-2.5 py-1 text-[11px] text-muted transition hover:border-[rgba(212,175,55,0.4)] hover:text-paper disabled:opacity-40"
              style={{ borderColor: "var(--color-line)" }}
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <input className="gm-input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Chiedi un'analisi sui dati del motore…" maxLength={600} />
          <button type="submit" className="gm-btn-accent shrink-0" disabled={busy || !input.trim()}>
            <Icon name="bolt" size={15} />
          </button>
        </form>
        <p className="mt-2 text-[10px] leading-relaxed text-[#60606b]">
          Motore deterministico sui dati del database: nessun prezzo, fee o opportunità viene generato dal modello. Nessun servizio AI a pagamento è configurato.
        </p>
      </div>
    </div>
  );
}
