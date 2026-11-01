import { Mutate } from "@/components/ActionButtons";
import { CredentialForm } from "@/components/InfraForms";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead, Empty } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { VENUES } from "@/lib/config";
import { all } from "@/lib/db";
import { ago, num } from "@/lib/format";
import { planLimits } from "@/lib/plans";

export const dynamic = "force-dynamic";

type CredRow = { id: string; venue_id: string; label: string; permissions: string; withdrawals_enabled: number; created_at: string };

const statusTone = (s: string) => (s === "live-public" ? "pos" : s === "public-api" ? "gold" : s === "partner-only" ? "warn" : "neg") as "pos" | "gold" | "warn" | "neg";

const statusLabel: Record<string, string> = {
  "live-public": "live · dati pubblici",
  "public-api": "API pubblica",
  "partner-only": "solo partner",
  "no-public-api": "nessuna API pubblica",
};

export default async function ExchangesPage() {
  const user = await requireUser();
  const credentials = all<CredRow>("SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at DESC", user.id);
  const limits = planLimits(user.plan);
  const apiVenues = VENUES.filter((v) => v.kind === "exchange" && v.balanceReadable).map((v) => ({ id: v.id, name: v.name }));

  return (
    <div className="space-y-4">
      <header>
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Infrastruttura</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Exchange e integrazioni</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          Stato verificato sulle fonti ufficiali il <span className="text-paper">1 novembre 2026</span>. Nessuna integrazione è dichiarata attiva se non è
          realmente disponibile: le piattaforme senza API di trading pubblico restano esterne al motore.
        </p>
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        {VENUES.map((v) => (
          <Card key={v.id} className="px-4 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="grid h-8 w-8 place-items-center rounded-md border text-[10px] font-bold uppercase" style={{ borderColor: "var(--line, #23232b)", color: "var(--accent)" }}>
                    {v.name.slice(0, 2)}
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-paper">{v.name}</div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{v.kind}</div>
                  </div>
                </div>
              </div>
              <Badge tone={statusTone(v.status)}>{statusLabel[v.status] ?? v.status}</Badge>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              <Row label="Market data" ok={v.publicMarketData} text={v.publicMarketData ? "pubblico" : "non disponibile"} />
              <Row label="Lettura saldi" ok={v.balanceReadable} text={v.balanceReadable ? "sì (read-only)" : "no"} />
              <Row label="Invio ordini" ok={v.orderPlacement} text={v.orderPlacement ? "via API ufficiale" : "non supportato"} />
              <Row label="Prelievi API" ok={false} text={v.withdrawalSupported === null ? "n/d" : v.withdrawalSupported ? "esistono, mai richiesti" : "no"} />
            </dl>

            {v.fee ? (
              <div className="mt-3 rounded-lg border px-2.5 py-2 text-[11px]" style={{ borderColor: "var(--color-line)" }}>
                <div className="flex items-center justify-between">
                  <span className="text-muted">Fee taker / maker</span>
                  <span className="num font-semibold text-paper">
                    {num(v.fee.takerPct, 2)}% / {num(v.fee.makerPct, 2)}%
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5">
                  <Badge tone={v.fee.confidence === "verified" ? "pos" : "warn"}>{v.fee.confidence}</Badge>
                  <a href={v.fee.source} target="_blank" rel="noreferrer noopener" className="truncate text-gold hover:underline">
                    fonte
                  </a>
                </div>
                {v.fee.note ? <p className="mt-1 leading-snug text-muted">{v.fee.note}</p> : null}
              </div>
            ) : null}

            <p className="mt-2 text-[11px] leading-relaxed text-muted">{v.notes}</p>
            <p className="mt-1 text-[10px] leading-relaxed text-[#686873]">{v.rateLimitNote}</p>
            <a href={v.apiDocs} target="_blank" rel="noreferrer noopener" className="mt-2 inline-block text-[11px] text-gold hover:underline">
              Documentazione ufficiale ↗
            </a>
          </Card>
        ))}
      </div>

      <Card>
        <CardHead
          title="API key collegate"
          subtitle={`${credentials.length} su ${limits.apiKeys} consentite dal piano ${user.plan.toUpperCase()}`}
          icon={<Icon name="lock" size={17} />}
        />
        {credentials.length ? (
          <div className="gm-scroll-x">
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Venue</th>
                  <th>Etichetta</th>
                  <th>Permessi</th>
                  <th>Prelievi</th>
                  <th>Aggiunta</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {credentials.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium text-paper">{VENUES.find((v) => v.id === c.venue_id)?.name ?? c.venue_id}</td>
                    <td className="text-[11px] text-muted">{c.label}</td>
                    <td>
                      <Badge tone="pos">{c.permissions}</Badge>
                    </td>
                    <td>
                      <Badge tone={c.withdrawals_enabled ? "neg" : "neutral"}>{c.withdrawals_enabled ? "abilitati" : "disabilitati"}</Badge>
                    </td>
                    <td className="text-[11px] text-muted">{ago(c.created_at)}</td>
                    <td className="text-right">
                      <Mutate url={`/api/credentials?id=${c.id}`} method="DELETE" label="Rimuovi" confirmText="Rimuovere questa API key cifrata?" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nessuna API key" body="Le chiavi sono opzionali: il motore lavora solo con dati pubblici. Servono per leggere i saldi e, in futuro, per il router autorizzato." />
        )}
        <div className="border-t" style={{ borderColor: "var(--color-line)" }}>
          <CredentialForm venues={apiVenues} />
        </div>
      </Card>

      <Callout tone="warn" title="Regola non negoziabile">
        Non chiediamo mai seed phrase o chiavi private. Le chiavi con permesso di prelievo vengono rifiutate a livello di flusso: la conferma di sola lettura è
        obbligatoria e i prelievi sono registrati come disabilitati nel database.
      </Callout>
    </div>
  );
}

function Row({ label, ok, text }: { label: string; ok: boolean; text: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className={ok ? "text-pos" : "text-[#7a7a85]"}>
        {text}
      </dd>
    </>
  );
}
