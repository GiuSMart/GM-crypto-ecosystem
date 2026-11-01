"use client";

import { useEffect, useState } from "react";
import { REFERENCE_FEES, VENUE_MAP } from "@/lib/config";
import { money, num, pct, timeOnly } from "@/lib/format";
import type { Board } from "@/lib/market";
import { Badge, Empty, cn } from "./ui";

/**
 * Live cross-venue board.
 * Polls the server route every 6s; the server itself caches for 4s so the public
 * venue APIs stay inside their documented rate limits.
 */
export default function MarketLive({ initial, compact = false }: { initial: Board; compact?: boolean }) {
  const quote = initial.quote;
  const [board, setBoard] = useState<Board>(initial);
  const [err, setErr] = useState<string | null>(null);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/market?quote=${quote}`, { cache: "no-store" });
        const json = (await res.json()) as { ok?: boolean; data?: Board; error?: string };
        if (stopped) return;
        if (json.ok && json.data) {
          setBoard(json.data);
          setErr(null);
          setPulse(true);
          setTimeout(() => !stopped && setPulse(false), 700);
        } else {
          setErr(json.error ?? "Dati non disponibili.");
        }
      } catch (e) {
        if (!stopped) setErr(`Connessione al mercato interrotta: ${(e as Error).message}`);
      }
    };

    timer = setInterval(tick, 6000);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [quote]);

  const rows = compact ? board.rows.slice(0, 6) : board.rows;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5" style={{ borderColor: "var(--color-line)" }}>
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em] text-muted">
          <span className={cn("inline-block h-1.5 w-1.5 rounded-full", err ? "bg-neg" : "bg-pos", pulse && "ring-2 ring-[rgba(61,220,151,0.35)]")} />
          {err ? "dati non aggiornati" : "dati pubblici live"} · {board.quote}
        </div>
        <div className="num text-[11px] text-muted">
          {board.ts ? `aggiornato ${timeOnly(board.ts)}` : "in attesa"} · refresh 6s
        </div>
      </div>

      {err ? <div className="border-b border-[rgba(255,107,107,0.25)] bg-[rgba(255,107,107,0.06)] px-4 py-2 text-[11px] text-neg">{err}</div> : null}

      {!rows.length ? (
        <Empty title="Nessuna coppia disponibile" body="Le API pubbliche non hanno restituito coppie comuni. Riprova tra poco o controlla la pagina Exchange." />
      ) : (
        <div className="gm-scroll-x">
          <table className="gm-table">
            <thead>
              <tr>
                <th>Coppia</th>
                <th className="text-right">Miglior acquisto</th>
                <th className="text-right">Miglior vendita</th>
                <th className="text-right">Spread lordo</th>
                <th className="text-right">Fee taker</th>
                <th className="text-right">Netto?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const buyFee = row.bestBuy ? REFERENCE_FEES[row.bestBuy.venue]?.takerPct ?? 0 : 0;
                const sellFee = row.bestSell ? REFERENCE_FEES[row.bestSell.venue]?.takerPct ?? 0 : 0;
                const floor = buyFee + sellFee;
                const positive = row.grossSpreadPct > floor;
                return (
                  <tr key={row.pair}>
                    <td>
                      <div className="font-semibold text-paper">{row.pair}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.venues.map((v) => (
                          <span key={v.venue} className="rounded border px-1.5 py-0.5 text-[10px] text-muted" style={{ borderColor: "var(--color-line)" }}>
                            {VENUE_MAP[v.venue]?.name ?? v.venue} <span className="num text-paper/80">{money(v.ask)}</span>
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="num text-right">
                      <div className="text-pos">{money(row.bestBuy?.ask ?? 0)}</div>
                      <div className="text-[10px] text-muted">{VENUE_MAP[row.bestBuy?.venue ?? ""]?.name ?? "—"}</div>
                    </td>
                    <td className="num text-right">
                      <div className="text-neg">{money(row.bestSell?.bid ?? 0)}</div>
                      <div className="text-[10px] text-muted">{VENUE_MAP[row.bestSell?.venue ?? ""]?.name ?? "—"}</div>
                    </td>
                    <td className={cn("num text-right font-semibold", positive ? "text-gold" : "text-muted")}>{pct(row.grossSpreadPct)}</td>
                    <td className="num text-right text-muted">{num(floor, 2)}%</td>
                    <td className="text-right">
                      <Badge tone={positive ? "gold" : "neutral"} title={positive ? "Lo spread supera le fee: serve la verifica di profondità" : "Lo spread non copre le sole commissioni taker"}>
                        {positive ? "da verificare" : "impossibile"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="px-4 py-2 text-[10px] leading-relaxed text-muted">
        “impossibile” significa che lo spread top-of-book non copre nemmeno le due fee taker: nessun calcolo di profondità può renderlo profittevole.
        La verifica completa (slippage, profondità, trasferimento, buffer) viene eseguita dal motore sulle coppie migliori.
      </div>
    </div>
  );
}
