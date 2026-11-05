import Link from "next/link";
import { CloseTradeButton, ScanButton } from "@/components/ActionButtons";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead, Empty, Stat, cn } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { dt, money, num, pct } from "@/lib/format";
import { listPaperTrades, paperStats } from "@/lib/paper";
import { PAPER_PNL_FORMULA_VERSION } from "@/lib/engine/paper-analytics";

export const dynamic = "force-dynamic";

export default async function PaperPage() {
  const user = await requireUser();
  const trades = listPaperTrades(user.id, 200);
  const stats = paperStats(user.id);
  const official = stats.comparable;
  const legacy = stats.legacy;
  const hasLegacy = legacy.closedCount > 0;
  const open = trades.filter((t) => t.status === "open");
  const closed = trades.filter((t) => t.status === "closed");

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Modalità B</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Paper trading</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            Simulazione a capitale zero. Ogni operazione viene aperta solo se il segnale è eseguibile con i dati correnti, poi viene chiusa marcando la gamba di
            vendita al bid ladder live: così il risultato simulato include fee, slippage e buffer reali, non stime. Le statistiche ufficiali usano solo i risultati
            prodotti dalla formula corrente (V2): quelli calcolati con la formula precedente restano consultabili separatamente e non entrano mai nei totali.
          </p>
        </div>
        <Link href="/opportunities" className="gm-btn text-xs">
          <Icon name="target" size={15} /> Vai ai segnali
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Operazioni aperte" value={stats.openCount} sub={`atteso ${money(stats.openExpectedTotal)}`} />
        <Stat label="Operazioni chiuse (V2)" value={official.closedCount} sub={`${official.wins} vincenti / ${official.losses} perdenti`} />
        <Stat
          label="Realizzato simulato (V2)"
          value={money(official.realizedTotal)}
          tone={official.realizedTotal > 0 ? "pos" : official.realizedTotal < 0 ? "neg" : "neutral"}
          sub="netto dopo tutti i costi · serie ufficiale"
        />
        <Stat
          label="Win rate (V2)"
          value={official.winRate === null ? "—" : `${num(official.winRate, 1)}%`}
          tone={official.winRate && official.winRate > 50 ? "pos" : "neutral"}
          sub={`margine medio ${official.avgRealizedMarginPct === null ? "—" : pct(official.avgRealizedMarginPct)}`}
        />
      </div>

      <section className="space-y-2">
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Qualità delle simulazioni chiuse · serie ufficiale V2</div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Stat
            label="Profit factor"
            value={official.profitFactor === null ? (official.wins > 0 ? "∞" : "—") : num(official.profitFactor, 2)}
            sub="profitti lordi / perdite lorde"
            tone={official.profitFactor !== null && official.profitFactor >= 1 ? "pos" : "neutral"}
          />
          <Stat label="Vincita media" value={official.averageWin === null ? "—" : money(official.averageWin)} tone="pos" sub="solo trade positivi" />
          <Stat label="Perdita media" value={official.averageLoss === null ? "—" : money(official.averageLoss)} tone="neg" sub="solo trade negativi" />
          <Stat label="Miglior trade" value={official.bestTrade === null ? "—" : money(official.bestTrade)} tone={official.bestTrade !== null && official.bestTrade > 0 ? "pos" : "neutral"} sub="risultato netto" />
          <Stat label="Peggior trade" value={official.worstTrade === null ? "—" : money(official.worstTrade)} tone={official.worstTrade !== null && official.worstTrade < 0 ? "neg" : "neutral"} sub="risultato netto" />
        </div>
        <p className="text-[10px] leading-relaxed text-muted">
          Il profit factor confronta la somma dei risultati positivi con il valore assoluto delle perdite. Se non esistono perdite, viene mostrato ∞ quando ci sono vincite. Ogni valore qui
          deriva solo da chiusure V2.
        </p>
      </section>

      {hasLegacy || stats.unknownResultCount > 0 ? (
        <Card className="overflow-hidden">
          <CardHead
            title="Storico precedente (V1)"
            subtitle="Risultati conservati, esclusi dai totali ufficiali"
            icon={<Icon name="history" size={17} />}
            action={<Badge tone="warn">Non comparabile</Badge>}
          />
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Operazioni V1" value={legacy.closedCount} sub="chiuse con la formula precedente" />
            <Stat label="Realizzato V1" value={money(legacy.realizedTotal)} tone="neutral" sub="mostrato, mai sommato al V2" />
            <Stat label="Win rate V1" value={legacy.winRate === null ? "—" : `${num(legacy.winRate, 1)}%`} sub="serie storica" />
            <Stat
              label="Esclusi dal totale"
              value={legacy.closedCount + stats.unknownResultCount}
              sub={stats.unknownResultCount ? `${stats.unknownResultCount} senza esito leggibile` : "solo formula precedente"}
            />
          </div>
          <div className="p-3 pt-0">
            <Callout tone="warn" title="Perché non vengono corretti né sommati">
              Queste chiusure addebitavano due volte la fee di trasferimento: il loro risultato è più basso di quanto la formula corrente avrebbe prodotto. I costi originali sono
              aggregati e i prezzi arrotondati, quindi non è possibile ricostruire il valore corretto senza inventarlo: i numeri restano quelli salvati, marcati come storici.
            </Callout>
          </div>
        </Card>
      ) : null}

      <Card className="overflow-hidden">
        <CardHead title="Posizioni aperte" subtitle="La chiusura marca l'uscita al mercato corrente" icon={<Icon name="layers" size={17} />} action={<Badge tone="gold">{open.length}</Badge>} />
        {open.length ? (
          <div className="gm-scroll-x">
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Coppia</th>
                  <th>Direzione</th>
                  <th className="text-right">Notional</th>
                  <th className="text-right">Q.tà</th>
                  <th className="text-right">Atteso</th>
                  <th className="text-right">Margine atteso</th>
                  <th>Aperta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {open.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium text-paper">{t.pair}</td>
                    <td className="text-[11px] text-muted">
                      <div className="text-pos">buy {t.buy_venue}</div>
                      <div className="text-neg">sell {t.sell_venue}</div>
                    </td>
                    <td className="num text-right">{money(t.notional)}</td>
                    <td className="num text-right text-muted">{num(t.qty, 6)}</td>
                    <td className={cn("num text-right font-semibold", t.expected_profit > 0 ? "text-pos" : "text-neg")}>{money(t.expected_profit)}</td>
                    <td className="num text-right text-muted">{pct(t.expected_margin_pct)}</td>
                    <td className="text-[11px] text-muted">{dt(t.opened_at)}</td>
                    <td className="text-right">
                      <CloseTradeButton tradeId={t.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Nessuna posizione aperta"
            body="Apri un paper trade da un segnale eseguibile nella pagina Opportunità. I segnali scartati non possono essere aperti: la simulazione rispetta la stessa regola del live."
            action={<Link href="/opportunities" className="gm-btn text-xs">Opportunità</Link>}
          />
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHead title="Storico simulazioni" subtitle="Previsto contro realizzato · serie separata per formula" icon={<Icon name="history" size={17} />} />
        {closed.length ? (
          <div className="gm-scroll-x">
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Coppia</th>
                  <th>Direzione</th>
                  <th>Formula</th>
                  <th className="text-right">Atteso</th>
                  <th className="text-right">Realizzato</th>
                  <th className="text-right">Margine</th>
                  <th>Aperta</th>
                  <th>Chiusa</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((t) => (
                  <tr key={t.id}>
                    <td className="font-medium text-paper">{t.pair}</td>
                    <td className="text-[11px] text-muted">
                      {t.buy_venue} → {t.sell_venue}
                    </td>
                    <td>
                      {t.pnl_formula_version === PAPER_PNL_FORMULA_VERSION ? (
                        <Badge tone="pos" title="Risultato prodotto dalla formula corrente: entra nei totali ufficiali">V2</Badge>
                      ) : (
                        <Badge tone="warn" title="Formula precedente: risultato conservato ma escluso dai totali ufficiali">V1</Badge>
                      )}
                    </td>
                    <td className="num text-right text-muted">{money(t.expected_profit)}</td>
                    <td className={cn("num text-right font-semibold", (t.realized_profit ?? 0) > 0 ? "text-pos" : "text-neg")}>{money(t.realized_profit)}</td>
                    <td className="num text-right text-muted">{pct(t.realized_margin_pct)}</td>
                    <td className="text-[11px] text-muted">{dt(t.opened_at)}</td>
                    <td className="text-[11px] text-muted">{dt(t.closed_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nessuna simulazione chiusa" body="Chiudi una posizione aperta per confrontare il profitto atteso con il risultato simulato." />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Callout tone="neutral" title="Perché il realizzato può differire dall'atteso">
          Tra apertura e chiusura il book cambia. La quantità è già al netto dell&apos;eventuale fee di trasferimento contabilizzata all&apos;apertura. Il realizzato ricalcola i proventi sul bid corrente e sottrae la fee taker di vendita e il buffer, senza addebitare due volte il trasferimento.
        </Callout>
        <Callout tone="warn" title="Cosa non è">
          Il paper trading non allena l&apos;esecuzione reale: non modella la latenza dell&apos;ordine, il rifiuto del venue o il parziale riempimento oltre il book
          snapshot. Serve a validare il <em>modello di costo</em>, non a garantire un profitto futuro.
        </Callout>
      </div>

      <div className="flex items-center gap-2">
        <ScanButton label="Nuova scansione" />
        <span className="text-[11px] text-muted">Le simulazioni usano le soglie del tuo account.</span>
      </div>
    </div>
  );
}
