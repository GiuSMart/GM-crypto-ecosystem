import FeeForm from "@/components/FeeForm";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ASSETS, VENUES } from "@/lib/config";
import { resolveFee } from "@/lib/engine/fees";
import { num } from "@/lib/format";
import { getNetworkFees } from "@/lib/network-fees";

export const dynamic = "force-dynamic";

export default async function FeesPage() {
  const user = await requireUser();
  const rows = VENUES.filter((v) => v.fee).map((v) => ({ venue: v, resolved: resolveFee(v.id, user.id) }));
  const network = getNetworkFees();

  return (
    <div className="space-y-4">
      <header>
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Costi</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Commissioni e costi di trasferimento</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          Il margine netto dipende da questi numeri. Il motore usa sempre la fee <strong className="text-paper">taker</strong> (l&apos;arbitraggio attraversa lo
          spread) e la tua impostazione sostituisce il valore di riferimento. Ogni valore mostra la sua provenienza.
        </p>
      </header>

      <Card className="overflow-hidden">
        <CardHead title="Fee per venue" subtitle="Tier più basso; il tuo tier reale può essere migliore" icon={<Icon name="percent" size={17} />} />
        <div className="gm-scroll-x">
          <table className="gm-table">
            <thead>
              <tr>
                <th>Venue</th>
                <th className="text-right">Maker</th>
                <th className="text-right">Taker</th>
                <th>Confidenza</th>
                <th>Fonte</th>
                <th>Nota</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ venue, resolved }) => (
                <tr key={venue.id}>
                  <td className="font-medium text-paper">{venue.name}</td>
                  <td className="num text-right">{num(resolved?.makerPct ?? venue.fee!.makerPct, 2)}%</td>
                  <td className="num text-right font-semibold">{num(resolved?.takerPct ?? venue.fee!.takerPct, 2)}%</td>
                  <td>
                    <Badge tone={venue.fee!.confidence === "verified" ? "pos" : venue.fee!.confidence === "user" ? "gold" : "warn"}>{venue.fee!.confidence}</Badge>
                  </td>
                  <td className="max-w-[220px] truncate text-[11px]">
                    <a href={venue.fee!.source} target="_blank" rel="noreferrer noopener" className="text-gold hover:underline">
                      {venue.fee!.source}
                    </a>
                  </td>
                  <td className="max-w-[280px] text-[11px] leading-snug text-muted">{venue.fee!.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t" style={{ borderColor: "var(--color-line)" }}>
          <FeeForm
            isAdmin={user.role === "admin"}
            venues={rows.map(({ venue }) => ({ id: venue.id, name: venue.name, takerPct: venue.fee!.takerPct, makerPct: venue.fee!.makerPct }))}
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <CardHead title="Fee di rete per asset" subtitle="Configurabili in Impostazioni; vuoto = costo sconosciuto" icon={<Icon name="bolt" size={17} />} />
        <div className="flex flex-wrap gap-1.5 px-4 py-3">
          {ASSETS.map((asset) => {
            const f = network[asset];
            const configured = f?.feeInBase != null;
            return (
              <span key={asset} className={`gm-badge ${configured ? "gm-badge-pos" : "gm-badge-warn"}`} title={f?.source}>
                {asset}: {configured ? `${num(f.feeInBase!, 8)}` : "non configurato"}
              </span>
            );
          })}
        </div>
        <p className="px-4 pb-3 text-[11px] leading-relaxed text-muted">
          In modalità <span className="text-paper">transfer</span> una fee di rete mancante blocca ogni segnale. Non inseriamo valori inventati: un costo
          sconosciuto non può produrre un profitto affidabile.
        </p>
      </Card>

      <Callout tone="warn" title="Verifica sempre il tuo tier">
        Kraken Tier 1: 0.40% maker / 0.80% taker (fonte ufficiale, verificata). Coinbase Advanced: il valore 0.50%/0.90% proviene da fonte secondaria — la pagina
        ufficiale ha bloccato la lettura automatica. Se operi in EU/UK il tier introduttivo indicato è 0.25%/0.50%: inseriscilo come override, altrimenti il
        motore sovrastima i costi e scarta operazioni che sarebbero redditizie.
      </Callout>
    </div>
  );
}
