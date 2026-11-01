import { OpenPaperButton, ScanButton } from "@/components/ActionButtons";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead, Empty, Stat, cn } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/db";
import { money, num, pct, ago } from "@/lib/format";
import { latestOpportunities, latestScan, parsePayload } from "@/lib/market";

export const dynamic = "force-dynamic";

export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ only?: string; show?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const settings = getUserSettings(user.id);
  const scan = latestScan();
  const all = scan ? latestOpportunities(scan.ts, 60) : [];
  const rows = params.only === "exec" ? all.filter((o) => o.executable === 1) : all;
  const executable = all.filter((o) => o.executable === 1).length;
  const best = all.length ? Math.max(...all.map((o) => o.margin_pct)) : null;
  const showCurve = params.show === "1";

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Motore di arbitraggio</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Opportunità nette</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            Ogni riga è un candidato valutato con order book reali. Soglia minima: <strong className="text-gold">{num(settings.minMarginPct, 2)}%</strong> di
            margine netto, notional {money(settings.notionalQuote)}. La regola resta: <strong className="text-paper">NO PROFIT = NO TRADE</strong>.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ScanButton />
          <a href="?only=exec" className={cn("gm-btn text-xs", params.only === "exec" && "border-[rgba(212,175,55,0.5)] text-gold")}>
            Solo eseguibili
          </a>
          <a href="?" className="gm-btn text-xs">
            Tutti
          </a>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Candidati valutati" value={all.length} sub={scan ? `ultima scansione ${ago(scan.ts)}` : "nessuna scansione"} />
        <Stat label="Eseguibili" value={executable} tone={executable ? "gold" : "neutral"} sub={`soglia ${num(settings.minMarginPct, 2)}% netto`} />
        <Stat label="Margine migliore" value={best === null ? "—" : pct(best)} tone={best && best > 0 ? "pos" : "neg"} sub="dopo fee, slippage, buffer e trasferimento" />
      </div>

      <Card className="overflow-hidden">
        <CardHead
          title="Valutazioni dell'ultima scansione"
          subtitle="Lo spread lordo è mostrato solo per confronto: la colonna decisionale è il margine netto"
          icon={<Icon name="target" size={17} />}
          action={<a href="?show=1" className="text-[11px] text-gold hover:underline">{showCurve ? "nascondi" : "mostra"} curve di sizing</a>}
        />
        {rows.length ? (
          <div className="gm-scroll-x">
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Coppia</th>
                  <th>Direzione</th>
                  <th className="text-right">Spread lordo</th>
                  <th className="text-right">Fee taker</th>
                  <th className="text-right">Slippage</th>
                  <th className="text-right">Buffer</th>
                  <th className="text-right">Netto</th>
                  <th className="text-right">Margine</th>
                  <th>Esito</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const payload = parsePayload(o);
                  return (
                    <tr key={o.id}>
                      <td className="font-medium text-paper">{o.pair}</td>
                      <td className="text-[11px] text-muted">
                        <div className="text-pos">buy {o.buy_venue}</div>
                        <div className="text-neg">sell {o.sell_venue}</div>
                      </td>
                      <td className="num text-right text-muted">{pct(o.gross_spread_pct)}</td>
                      <td className="num text-right text-muted">{money(o.fee_buy + o.fee_sell)}</td>
                      <td className="num text-right text-muted">{num(o.slippage_pct, 3)}%</td>
                      <td className="num text-right text-muted">{money(o.buffer_cost)}</td>
                      <td className={cn("num text-right font-semibold", o.net_profit > 0 ? "text-pos" : "text-neg")}>{money(o.net_profit)}</td>
                      <td className={cn("num text-right font-semibold", o.margin_pct >= settings.minMarginPct ? "text-pos" : "text-neg")}>{pct(o.margin_pct)}</td>
                      <td>
                        <Badge tone={o.executable ? "pos" : "neg"}>{o.executable ? "eseguibile" : "scartato"}</Badge>
                        {o.reject_reason ? (
                          <div className="mt-1 max-w-[260px] text-[10px] leading-snug text-muted" title={o.reject_reason}>
                            {o.reject_reason.split(" | ")[0]}
                          </div>
                        ) : null}
                        {showCurve && Array.isArray(payload.curve) ? (
                          <div className="mt-1 space-y-0.5">
                            {(payload.curve as { notional: number; net: number; executable: boolean }[]).map((c) => (
                              <div key={c.notional} className={cn("num text-[10px]", c.executable ? "text-pos" : "text-muted")}>
                                {money(c.notional, "USD", 0)} → {money(c.net)}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </td>
                      <td className="text-right">
                        <OpenPaperButton opportunityId={o.id} disabled={o.executable !== 1} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty
            title="Nessuna valutazione registrata"
            body="Il motore non inventa opportunità: servono order book reali. Avvia una scansione per popolare questa tabella."
            action={<ScanButton label="Esegui scansione" />}
          />
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="Come viene deciso l'esito" subtitle="Controlli bloccanti, in ordine" icon={<Icon name="shield" size={17} />} />
          <ol className="space-y-2 px-4 py-4 text-[11px] leading-relaxed text-muted">
            <li>1. Book aggiornati entro {settings.maxDataAgeMs} ms (dati vecchi = nessun segnale).</li>
            <li>2. Riempimento completo della quantità sul book di acquisto e di vendita.</li>
            <li>3. Slippage di profondità entro {num(settings.maxSlippagePct, 2)}% su entrambe le gambe.</li>
            <li>4. Fee taker, buffer {num(settings.safetyBufferPct, 3)}% e, se in modalità transfer, fee di rete nota.</li>
            <li>5. Profitto netto &gt; 0 e margine ≥ {num(settings.minMarginPct, 2)}%.</li>
          </ol>
        </Card>
        <Card>
          <CardHead title="Stato della configurazione" subtitle="Parametri che influenzano direttamente il risultato" icon={<Icon name="settings" size={17} />} />
          <ul className="space-y-2 px-4 py-4 text-[11px] text-muted">
            <li>
              Modalità trasferimento: <span className="text-paper">{settings.transferMode === "prefunded" ? "prefunded (inventario su entrambe le venue)" : "transfer (fee di rete incluse)"}</span>
            </li>
            <li>
              Notional per operazione: <span className="num text-paper">{money(settings.notionalQuote)}</span>
            </li>
            <li>
              Monitoraggio: <span className={settings.monitoringEnabled ? "text-pos" : "text-warn"}>{settings.monitoringEnabled ? "attivo" : "in pausa"}</span>
            </li>
            <li>
              Valuta: <span className="text-paper">{settings.quote}</span> · Soglia candidati {num(settings.candidateSpreadPct, 2)}%
            </li>
          </ul>
        </Card>
      </div>

      <Callout tone="warn" title="Nota sui numeri">
        Le commissioni Coinbase sono marcate come <em>non verificate</em> sulla fonte ufficiale. Se il tuo tier reale è diverso, inseriscilo in Commissioni:
        ogni punto percentuale di fee cambia radicalmente il margine netto e quindi l&apos;esito.
      </Callout>
    </div>
  );
}
