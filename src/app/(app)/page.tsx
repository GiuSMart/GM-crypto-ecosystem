import Link from "next/link";
import { OpenPaperButton, ScanButton } from "@/components/ActionButtons";
import MarketLive from "@/components/MarketLive";
import MonitorRunner from "@/components/MonitorRunner";
import { Icon } from "@/components/icons";
import { AreaChart, Badge, Callout, Card, CardHead, Empty, KV, Stat, cn } from "@/components/ui";
import { VENUE_MAP, type Quote } from "@/lib/config";
import { requireUser } from "@/lib/auth";
import { all, getUserSettings } from "@/lib/db";
import { ago, money, num, pct } from "@/lib/format";
import { getBoard, latestOpportunities, latestScan, marginSeries, parsePayload, type Board } from "@/lib/market";
import { activeLiveAuthorization, liveBlockers } from "@/lib/live";
import { paperStats } from "@/lib/paper";
import { planLimits } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const user = await requireUser();
  const settings = getUserSettings(user.id);
  const limits = planLimits(user.plan);
  const monitorIntervalMs = Math.max(60_000, Math.ceil(3_600_000 / Math.max(1, limits.scansPerHour)));
  const quote = settings.quote as Quote;

  let board: Board = { quote, ts: 0, rows: [], errors: [] };
  try {
    board = await getBoard(quote);
  } catch (err) {
    board.errors.push((err as Error).message);
  }

  const scan = latestScan();
  const opportunities = scan ? latestOpportunities(scan.ts) : [];
  const ranked = [...opportunities].sort((a, b) => (Number.isFinite(b.margin_pct) ? b.margin_pct : -1e9) - (Number.isFinite(a.margin_pct) ? a.margin_pct : -1e9));
  const bestSignal = ranked.find((o) => o.executable === 1) ?? ranked[0] ?? null;
  const payload = bestSignal ? parsePayload(bestSignal) : {};
  const executableCount = opportunities.filter((o) => o.executable === 1).length;
  const paper = paperStats(user.id);
  const series = marginSeries(30);
  const live = activeLiveAuthorization(user.id);
  const credentials = all<{ id: string }>("SELECT id FROM credentials WHERE user_id = ?", user.id);
  const wallets = all<{ id: string }>("SELECT id FROM wallets WHERE user_id = ?", user.id);
  const blockers = liveBlockers({ authorization: live, settings, credentialCount: credentials.length });
  const topBoard = board.rows[0];
  const feeFloor = topBoard
    ? (VENUE_MAP[topBoard.bestBuy?.venue ?? ""]?.fee?.takerPct ?? 0) + (VENUE_MAP[topBoard.bestSell?.venue ?? ""]?.fee?.takerPct ?? 0)
    : 0;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-pos" />
            Panoramica · {user.displayName}
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper sm:text-3xl">
            Opportunità con <span className="gold-text">margine netto</span> verificato
          </h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted">
            Dati pubblici da {board.rows.length} coppie su {Object.keys(VENUE_MAP).filter((v) => VENUE_MAP[v].publicMarketData).length} venue reali.
            Ogni segnale include fee taker, slippage di profondità, costi di trasferimento e buffer. Se il netto non è positivo, non è un&apos;opportunità.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScanButton />
          <Link href="/opportunities" className="gm-btn text-xs">
            <Icon name="target" size={15} /> Dettaglio
          </Link>
        </div>
      </header>

      <div className="grid gap-2 sm:grid-cols-3">
        <ModeCard
          title="A · Monitoraggio"
          active={settings.monitoringEnabled}
          body={settings.monitoringEnabled ? `Scansioni automatiche ogni ${Math.round(monitorIntervalMs / 1000)}s quando la dashboard è aperta.` : "Monitoraggio in pausa dalle impostazioni."}
        />
        <ModeCard title="B · Paper trading" active body={`Simulazione senza denaro reale · ${paper.openCount} aperte`} />
        <ModeCard
          title="C · Live trading"
          active={settings.liveTradingEnabled && Boolean(live)}
          warn
          body={`Bloccato · ${blockers.length} condizioni non soddisfatte`}
        />
      </div>

      <MonitorRunner enabled={settings.monitoringEnabled} intervalMs={monitorIntervalMs} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Stat
          label="Miglior margine netto"
          value={bestSignal ? pct(bestSignal.margin_pct) : "—"}
          tone={bestSignal && bestSignal.margin_pct > 0 ? "pos" : "neg"}
          sub={bestSignal ? `${bestSignal.pair} · ${VENUE_MAP[bestSignal.buy_venue]?.name} → ${VENUE_MAP[bestSignal.sell_venue]?.name}` : "Esegui una scansione"}
        />
        <Stat
          label="Segnali eseguibili"
          value={executableCount}
          tone={executableCount > 0 ? "gold" : "neutral"}
          sub={`su ${opportunities.length} candidati valutati${scan ? ` · ${ago(scan.ts)}` : ""}`}
        />
        <Stat
          label="Spread più ampio (live)"
          value={topBoard ? pct(topBoard.grossSpreadPct) : "—"}
          sub={topBoard ? `pavimento fee ${num(feeFloor, 2)}% · ${topBoard.pair}` : "dati non disponibili"}
          tone={topBoard && topBoard.grossSpreadPct > feeFloor ? "pos" : "neg"}
        />
        <Stat
          label="Paper trading realizzato"
          value={money(paper.realizedTotal)}
          tone={paper.realizedTotal > 0 ? "pos" : paper.realizedTotal < 0 ? "neg" : "neutral"}
          sub={`${paper.closedCount} chiuse · ${paper.openCount} aperte`}
        />
        <Stat
          label="Profitto previsto (chiuse)"
          value={money(paper.expectedClosedTotal)}
          sub="stima registrata all'apertura"
          tone="neutral"
        />
        <Stat
          label="Scostamento dal previsto"
          value={money(paper.realizedDelta)}
          tone={paper.realizedDelta > 0 ? "pos" : paper.realizedDelta < 0 ? "neg" : "neutral"}
          sub={paper.realizationPct === null ? "rapporto non calcolabile" : `${num(paper.realizationPct, 1)}% del previsto`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card className="overflow-hidden">
          <CardHead
            title="Prezzi tra venue"
            subtitle="Order book e ticker pubblici, confronto diretto dello stesso asset"
            icon={<Icon name="chart" size={17} />}
            action={<Badge tone="gold">live</Badge>}
          />
          <MarketLive initial={board} compact />
        </Card>

        <Card>
          <CardHead
            title="Miglior candidato"
            subtitle={bestSignal ? `${bestSignal.pair} · notional ${money(bestSignal.notional)}` : "Nessuna scansione registrata"}
            icon={<Icon name="target" size={17} />}
            action={bestSignal ? <Badge tone={bestSignal.executable ? "pos" : "neg"}>{bestSignal.executable ? "eseguibile" : "scartato"}</Badge> : undefined}
          />
          {bestSignal ? (
            <>
              <div className="grid grid-cols-2 gap-3 px-4 py-4">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted">Acquisto</div>
                  <div className="mt-0.5 text-sm font-semibold text-paper">{VENUE_MAP[bestSignal.buy_venue]?.name}</div>
                  <div className="num text-xs text-pos">{money(bestSignal.buy_vwap)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase tracking-[0.14em] text-muted">Vendita</div>
                  <div className="mt-0.5 text-sm font-semibold text-paper">{VENUE_MAP[bestSignal.sell_venue]?.name}</div>
                  <div className="num text-xs text-neg">{money(bestSignal.sell_vwap)}</div>
                </div>
              </div>
              <KV
                rows={[
                  { k: "Spread lordo", v: pct(bestSignal.gross_spread_pct) },
                  { k: "Break-even stimato", v: payload.breakevenSpreadPct ? pct(Number(payload.breakevenSpreadPct)) : "—" },
                  { k: "Fee acquisto", v: money(bestSignal.fee_buy) },
                  { k: "Fee vendita", v: money(bestSignal.fee_sell) },
                  { k: "Buffer di sicurezza", v: money(bestSignal.buffer_cost) },
                  { k: "Costo trasferimento", v: money(bestSignal.transfer_cost) },
                  { k: "Profitto netto", v: <span className={bestSignal.net_profit > 0 ? "text-pos" : "text-neg"}>{money(bestSignal.net_profit)}</span> },
                  { k: "Margine netto", v: <span className={bestSignal.margin_pct > 0 ? "text-pos" : "text-neg"}>{pct(bestSignal.margin_pct)}</span> },
                ]}
              />
              <div className="flex items-center justify-between gap-2 px-4 py-3">
                <div className="text-[10px] leading-snug text-muted">
                  {bestSignal.executable ? "Tutti i controlli superati." : bestSignal.reject_reason?.split(" | ")[0]}
                </div>
                <OpenPaperButton opportunityId={bestSignal.id} disabled={bestSignal.executable !== 1} />
              </div>
            </>
          ) : (
            <Empty
              title="Nessun segnale ancora"
              body="Avvia una scansione: il motore legge gli order book pubblici e registra ogni candidato con il suo esito."
              action={<ScanButton label="Prima scansione" />}
            />
          )}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHead
            title="Margine netto nel tempo"
            subtitle={series.length ? `Ultime ${series.length} scansioni` : "Curva costruita dalle scansioni reali"}
            icon={<Icon name="chart" size={17} />}
          />
          <div className="px-3 py-3">
            <AreaChart
              points={series.map((s) => ({ label: s.ts.slice(11, 16), value: s.best }))}
              formatValue={(v) => pct(v, 2)}
              height={170}
            />
            <p className="mt-2 px-1 text-[10px] leading-relaxed text-muted">
              Il valore è il margine netto migliore per scansione, dopo fee, slippage, buffer e trasferimento. Se la curva resta sotto zero, non ci sono operazioni ammissibili.
            </p>
          </div>
        </Card>

        <Card>
          <CardHead title="Perché non basta lo spread" subtitle="Scarti registrati nell'ultima scansione" icon={<Icon name="alert" size={17} />} />
          {opportunities.length ? (
            <div className="gm-scroll-x">
              <table className="gm-table">
                <thead>
                  <tr>
                    <th>Coppia</th>
                    <th className="text-right">Spread</th>
                    <th className="text-right">Netto</th>
                    <th>Esito</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.slice(0, 5).map((o) => (
                    <tr key={o.id}>
                      <td>
                        <div className="text-xs font-medium text-paper">{o.pair}</div>
                        <div className="text-[10px] text-muted">
                          {VENUE_MAP[o.buy_venue]?.name} → {VENUE_MAP[o.sell_venue]?.name}
                        </div>
                      </td>
                      <td className="num text-right text-xs text-muted">{pct(o.gross_spread_pct)}</td>
                      <td className={cn("num text-right text-xs font-semibold", o.net_profit > 0 ? "text-pos" : "text-neg")}>{money(o.net_profit)}</td>
                      <td className="text-right">
                        <Badge tone={o.executable ? "pos" : "neg"} title={o.reject_reason ?? ""}>
                          {o.executable ? "ok" : "no"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Nessuno scarto da mostrare" body="Gli scarti vengono registrati a ogni scansione, con il motivo completo." />
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="px-4 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Infrastruttura</h3>
            <Link href="/exchanges" className="text-[11px] text-gold hover:underline">
              Apri
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <div>
              <div className="num text-lg font-semibold text-paper">{credentials.length}</div>
              <div className="text-[10px] text-muted">API key</div>
            </div>
            <div>
              <div className="num text-lg font-semibold text-paper">{wallets.length}</div>
              <div className="text-[10px] text-muted">wallet</div>
            </div>
            <div>
              <div className="num text-lg font-semibold text-paper">{board.rows.length}</div>
              <div className="text-[10px] text-muted">coppie live</div>
            </div>
          </div>
        </Card>

        <Card className="px-4 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Modalità C · Live</h3>
            <Badge tone="warn">locked</Badge>
          </div>
          <ul className="mt-2 space-y-1.5 text-[11px] leading-relaxed text-muted">
            {blockers.slice(0, 3).map((b) => (
              <li key={b} className="flex gap-1.5">
                <Icon name="lock" size={12} className="mt-0.5 shrink-0 text-warn" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
          <Link href="/security" className="mt-3 inline-block text-[11px] text-gold hover:underline">
            Stato sicurezza e autorizzazioni →
          </Link>
        </Card>

        <Card className="px-4 py-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Ultima scansione</h3>
            <Link href="/history" className="text-[11px] text-gold hover:underline">
              Storico
            </Link>
          </div>
          {scan ? (
            <div className="mt-2 space-y-1 text-[11px] text-muted">
              <div>
                <span className="text-paper">{ago(scan.ts)}</span> · {scan.pairs} coppie · {scan.candidates} candidati
              </div>
              <div>Eseguibili: {scan.executable} · durata {Math.round(scan.duration_ms / 1000)}s</div>
              {scan.errors ? <div className="text-warn">Avvisi: {scan.errors.slice(0, 120)}…</div> : null}
            </div>
          ) : (
            <p className="mt-2 text-[11px] text-muted">Nessuna scansione registrata.</p>
          )}
        </Card>
      </div>

      <Callout tone="warn" title="Limiti dichiarati di questa build">
        Nessun ordine reale viene inviato: il router live non è implementato e i prelievi sono esclusi per progetto. Le commissioni Coinbase derivano da fonte
        secondaria (non verificata sulla pagina ufficiale): confermale nel tuo tier prima di considerare un margine come reale.
      </Callout>
    </div>
  );
}

function ModeCard({ title, body, active, warn }: { title: string; body: string; active: boolean; warn?: boolean }) {
  return (
    <div className={cn("rounded-xl border px-3.5 py-3", active ? "bg-[rgba(61,220,151,0.06)]" : "bg-white/[0.02]")} style={{ borderColor: active ? "rgba(61,220,151,0.3)" : "var(--color-line)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-paper">{title}</span>
        <Badge tone={active ? (warn ? "warn" : "pos") : "neutral"}>{active ? (warn ? "attivo" : "on") : "off"}</Badge>
      </div>
      <p className="mt-1 text-[11px] leading-snug text-muted">{body}</p>
    </div>
  );
}
