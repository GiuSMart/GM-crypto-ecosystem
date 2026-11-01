import Link from "next/link";
import SettingsForm from "@/components/SettingsForm";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead, KV } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { ASSETS } from "@/lib/config";
import { getBranding, getUserSettings } from "@/lib/db";
import { money, num } from "@/lib/format";
import { getNetworkFees } from "@/lib/network-fees";
import { getPlan, paymentsEnabled, planFeatures, planLimits } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const settings = getUserSettings(user.id);
  const networkFees = getNetworkFees();
  const branding = getBranding();
  const plan = getPlan(user.plan);
  const features = planFeatures(user.plan);
  const limits = planLimits(user.plan);

  return (
    <div className="space-y-4">
      <header>
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Configurazione</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Impostazioni</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          Le soglie sono per-account e sovrascrivono i default globali. Ogni modifica viene registrata nel log attività.
        </p>
      </header>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="px-4 py-4 lg:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-paper">Piano attuale</h2>
            <Badge tone="gold">{plan?.name ?? user.plan.toUpperCase()}</Badge>
          </div>
          <p className="mt-1 text-[11px] text-muted">{plan?.tagline ?? "—"}</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[11px] text-muted sm:grid-cols-4">
            <div>Venue: <span className="num text-paper">{limits.venues}</span></div>
            <div>Coppie: <span className="num text-paper">{limits.pairs}</span></div>
            <div>Scansioni/h: <span className="num text-paper">{limits.scansPerHour}</span></div>
            <div>API key: <span className="num text-paper">{limits.apiKeys}</span></div>
          </div>
          <ul className="mt-2 list-inside list-disc text-[11px] leading-relaxed text-muted">
            {features.slice(0, 4).map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between text-[11px]">
            <span className="text-muted">
              Prezzo: <span className="num text-paper">{plan ? money(plan.price_cents / 100, plan.currency) : "—"}</span> / mese
            </span>
            <Link href="/pricing" className="text-gold hover:underline">
              Confronta i piani →
            </Link>
          </div>
          {!paymentsEnabled() ? (
            <p className="mt-2 rounded-md border border-[rgba(245,181,68,0.3)] bg-[rgba(245,181,68,0.07)] px-2 py-1.5 text-[10px] leading-snug text-warn">
              Pagamenti non configurati: nessun addebito è attivo. Il cambio piano avviene solo tramite amministratore.
            </p>
          ) : null}
        </Card>

        <Card>
          <CardHead title="Export dati" subtitle="CSV del tuo account" icon={<Icon name="download" size={17} />} />
          <div className="space-y-2 px-4 py-4">
            <a href="/api/reports/export?kind=opportunities" className="gm-btn w-full justify-center text-xs">
              Opportunità (CSV)
            </a>
            <a href="/api/reports/export?kind=paper" className="gm-btn w-full justify-center text-xs">
              Paper trading (CSV)
            </a>
            <Link href="/security" className="gm-btn w-full justify-center text-xs">
              Sicurezza e sessioni
            </Link>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHead
          title="Parametri operativi"
          subtitle={`Notional attuale ${money(settings.notionalQuote)} · soglia ${num(settings.minMarginPct, 2)}%`}
          icon={<Icon name="settings" size={17} />}
        />
        <SettingsForm
          settings={settings}
          networkFees={networkFees}
          assets={ASSETS}
          role={user.role}
          brandName={user.brandName}
          brandAccent={user.brandAccent}
          globalBranding={{
            appName: branding.appName,
            logoMark: branding.logoMark,
            accent: branding.accent,
            tagline: branding.tagline,
            footer: branding.footer,
          }}
        />
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="px-4 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Valori correnti</h3>
          <div className="mt-2">
            <KV
              rows={[
                { k: "Modalità trasferimento", v: settings.transferMode },
                { k: "Valuta di quotazione", v: settings.quote },
                { k: "Spread candidato minimo", v: `${num(settings.candidateSpreadPct, 2)}%` },
                { k: "Età massima dati", v: `${settings.maxDataAgeMs} ms` },
                { k: "Capitale massimo per ordine", v: money(settings.maxOrderQuote) },
                { k: "Perdita massima giornaliera", v: money(settings.maxDailyLossQuote) },
              ]}
            />
          </div>
        </Card>
        <Callout tone="warn" title="Deploy multi-cliente (white-label)">
          Ogni istanza ha il proprio database, il proprio file <code className="text-paper">data/master.key</code> e il proprio branding. Per duplicare il
          prodotto per un altro cliente: nuova istanza, nuovo database, nuove chiavi, nuovo dominio. Non condividere mai il master key tra installazioni.
        </Callout>
      </div>
    </div>
  );
}
