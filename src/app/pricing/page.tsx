import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, Callout } from "@/components/ui";
import { money } from "@/lib/format";
import { listPlans, paymentsEnabled, planFeatures } from "@/lib/plans";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const plans = listPlans();
  const payments = paymentsEnabled();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-[rgba(212,175,55,0.45)] bg-[rgba(212,175,55,0.1)] text-sm font-bold text-gold">GM</span>
        <div>
          <div className="text-sm font-bold tracking-[0.14em] text-paper">GM CRYPTO ARBITRAGE AI</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">piani commerciali</div>
        </div>
      </div>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-paper">
        Scegli il livello di <span className="gold-text">monitoraggio</span>
      </h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
        I prezzi sono configurabili dall&apos;amministratore. Il piano FREE è immediato e non richiede carta. Nessun pagamento è attivo finché il provider non è
        configurato e verificato.
      </p>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {plans.map((p) => {
          const features = planFeatures(p.id);
          const highlight = p.id === "pro";
          return (
            <div key={p.id} className={`gm-card flex flex-col p-5 ${highlight ? "gm-panel-gold" : ""}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-paper">{p.name}</h2>
                {highlight ? <Badge tone="gold">consigliato</Badge> : null}
              </div>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="num text-3xl font-semibold text-paper">{p.price_cents === 0 ? "0" : money(p.price_cents / 100, p.currency)}</span>
                <span className="text-[11px] text-muted">/ mese</span>
              </div>
              <p className="mt-1 text-[11px] text-muted">{p.tagline}</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-[12px] leading-relaxed text-muted">
                {features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Icon name="check" size={14} className="mt-0.5 shrink-0 text-gold" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Link href={p.price_cents === 0 ? "/register" : "/login"} className={highlight ? "gm-btn-accent mt-4 justify-center" : "gm-btn mt-4 justify-center"}>
                {p.price_cents === 0 ? "Inizia gratis" : "Accedi per attivare"}
              </Link>
              <p className="mt-2 text-center text-[10px] text-[#686873]">{payments ? "Pagamenti configurabili" : "Pagamenti non configurati: attivazione manuale"}</p>
            </div>
          );
        })}
      </div>

      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Callout tone="warn" title="Nessun addebito automatico">
          In questa build il flag dei pagamenti è disattivato: i piani si assegnano manualmente dall&apos;area amministratore. Nessuna carta viene richiesta e
          nessun importo viene addebitato.
        </Callout>
        <Callout tone="neutral" title="White-label">
          Ogni licenza può essere installata su infrastruttura propria, con nome, logo e colore del cliente. Il prodotto commercializzato è il software GM, non
          l&apos;accesso a strumenti di terze parti.
        </Callout>
      </div>

      <div className="mt-8 flex flex-wrap gap-3 text-xs">
        <Link href="/login" className="text-gold hover:underline">
          Accedi
        </Link>
        <Link href="/register" className="text-gold hover:underline">
          Crea account FREE
        </Link>
      </div>
    </main>
  );
}
