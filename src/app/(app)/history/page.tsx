import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead, Empty, cn } from "@/components/ui";
import { listAudit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { ago, dt, money, pct } from "@/lib/format";
import { opportunityHistory, recentScans } from "@/lib/market";
import { planLimits } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const user = await requireUser();
  const limits = planLimits(user.plan);
  const scans = recentScans(25);
  const history = opportunityHistory(Math.min(limits.historyDays * 24, 24 * 30), 200);
  const audit = listAudit(user.id, 60, user.role === "admin");

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Dati</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Storico e audit</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            Storico del piano {user.plan.toUpperCase()}: {limits.historyDays} giorni. Scansioni, valutazioni e registro attività sono persistiti nel database
            locale; l&apos;export CSV è disponibile per il tuo account.
          </p>
        </div>
        <div className="flex gap-2">
          <a href="/api/reports/export?kind=opportunities" className="gm-btn text-xs">
            <Icon name="download" size={15} /> CSV opportunità
          </a>
          <a href="/api/reports/export?kind=paper" className="gm-btn text-xs">
            <Icon name="download" size={15} /> CSV paper
          </a>
        </div>
      </header>

      <Card className="overflow-hidden">
        <CardHead title="Scansioni" subtitle="Una riga per esecuzione del motore" icon={<Icon name="refresh" size={17} />} />
        {scans.length ? (
          <div className="gm-scroll-x">
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th className="text-right">Coppie</th>
                  <th className="text-right">Candidati</th>
                  <th className="text-right">Eseguibili</th>
                  <th className="text-right">Miglior margine</th>
                  <th className="text-right">Durata</th>
                  <th>Errori</th>
                </tr>
              </thead>
              <tbody>
                {scans.map((s) => (
                  <tr key={s.id}>
                    <td className="text-[11px] text-muted" title={dt(s.ts)}>
                      {ago(s.ts)}
                    </td>
                    <td className="num text-right">{s.pairs}</td>
                    <td className="num text-right">{s.candidates}</td>
                    <td className="num text-right">
                      <Badge tone={s.executable ? "pos" : "neutral"}>{s.executable}</Badge>
                    </td>
                    <td className={cn("num text-right font-semibold", (s.best_margin ?? 0) > 0 ? "text-pos" : "text-neg")}>
                      {s.best_margin === null ? "—" : pct(s.best_margin)}
                    </td>
                    <td className="num text-right text-muted">{Math.round(s.duration_ms / 1000)}s</td>
                    <td className="max-w-[220px] truncate text-[10px] text-warn">{s.errors ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nessuna scansione" body="Esegui la prima scansione dalla Panoramica." />
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHead title="Ultime valutazioni" subtitle={`Ultimi ${limits.historyDays} giorni, massimo 200 righe`} icon={<Icon name="target" size={17} />} />
        {history.length ? (
          <div className="gm-scroll-x">
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Coppia</th>
                  <th>Direzione</th>
                  <th className="text-right">Spread</th>
                  <th className="text-right">Netto</th>
                  <th className="text-right">Margine</th>
                  <th>Esito</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 80).map((o) => (
                  <tr key={o.id}>
                    <td className="text-[11px] text-muted">{dt(o.ts)}</td>
                    <td className="font-medium text-paper">{o.pair}</td>
                    <td className="text-[11px] text-muted">
                      {o.buy_venue} → {o.sell_venue}
                    </td>
                    <td className="num text-right text-muted">{pct(o.gross_spread_pct)}</td>
                    <td className={cn("num text-right", o.net_profit > 0 ? "text-pos" : "text-neg")}>{money(o.net_profit)}</td>
                    <td className="num text-right">{pct(o.margin_pct)}</td>
                    <td>
                      <Badge tone={o.executable ? "pos" : "neg"}>{o.executable ? "ok" : "no"}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nessuna valutazione nello storico" body="Lo storico si popola a ogni scansione." />
        )}
      </Card>

      <Card className="overflow-hidden">
        <CardHead title="Registro attività" subtitle={user.role === "admin" ? "Tutte le attività del sistema" : "Solo le attività del tuo account"} icon={<Icon name="shield" size={17} />} />
        {audit.length ? (
          <div className="gm-scroll-x">
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Azione</th>
                  <th>Target</th>
                  <th>IP</th>
                  <th>Dettagli</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="text-[11px] text-muted">{dt(a.ts)}</td>
                    <td className="text-[11px] font-medium text-paper">{a.action}</td>
                    <td className="max-w-[160px] truncate text-[11px] text-muted">{a.target ?? "—"}</td>
                    <td className="font-mono text-[10px] text-muted">{a.ip ?? "—"}</td>
                    <td className="max-w-[320px] truncate text-[10px] text-muted">{a.meta ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nessuna attività registrata" />
        )}
      </Card>

      <Callout tone="neutral" title="Conservazione">
        I dati restano nel database locale dell&apos;istanza. Il piano {user.plan.toUpperCase()} conserva {limits.historyDays} giorni di storico: oltre quella
        finestra le righe non sono più esposte dall&apos;interfaccia. Un backup pianificato va configurato a livello di infrastruttura.
      </Callout>

      <p className="text-[11px] text-muted">
        Vuoi esportare tutto? <Link href="/settings" className="text-gold hover:underline">Impostazioni → export</Link>.
      </p>
    </div>
  );
}
