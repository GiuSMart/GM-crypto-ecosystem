import Link from "next/link";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/AuthForms";
import { Icon } from "@/components/icons";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const demoEmail = process.env.GM_ADMIN_EMAIL ?? "admin@gmarbitrage.ai";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect("/");

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r px-10 py-12 lg:flex" style={{ borderColor: "var(--color-line)" }}>
        <div className="pointer-events-none absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[radial-gradient(circle,rgba(212,175,55,0.18),transparent_65%)]" />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-xl border border-[rgba(212,175,55,0.45)] bg-[rgba(212,175,55,0.1)] text-base font-bold text-gold">GM</span>
            <div>
              <div className="text-sm font-bold tracking-[0.16em] text-paper">GM CRYPTO ARBITRAGE AI</div>
              <div className="text-[11px] uppercase tracking-[0.2em] text-muted">net-profit arbitrage intelligence</div>
            </div>
          </div>

          <h1 className="mt-14 max-w-xl text-4xl font-semibold leading-[1.1] tracking-tight text-paper">
            Solo operazioni con <span className="gold-text">margine netto</span> positivo, dopo ogni costo.
          </h1>
          <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
            Il motore confronta order book reali tra exchange, somma commissioni taker, slippage di profondità, costi di
            trasferimento e buffer di sicurezza. Se il netto non è positivo, l&apos;opportunità viene scartata: NO PROFIT = NO TRADE.
          </p>

          <ul className="mt-10 space-y-3 text-sm">
            {[
              "Order book pubblici reali di Kraken e Coinbase Advanced",
              "Calcolo fee taker, slippage, trasferimento e margine netto",
              "Paper trading con confronto tra profitto atteso e realizzato",
              "Live trading bloccato: nessun prelievo, nessuna seed phrase",
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-muted">
                <Icon name="check" size={16} className="mt-0.5 shrink-0 text-gold" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative grid max-w-md grid-cols-3 gap-2 text-center">
          <div className="gm-card-tight px-2 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted">Modalità</div>
            <div className="mt-1 text-xs font-semibold text-paper">Monitor + Paper</div>
          </div>
          <div className="gm-card-tight px-2 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted">Live</div>
            <div className="mt-1 text-xs font-semibold text-warn">Bloccato</div>
          </div>
          <div className="gm-card-tight px-2 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted">Costi</div>
            <div className="mt-1 text-xs font-semibold text-pos">Zero servizi a pagamento</div>
          </div>
        </div>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-lg border border-[rgba(212,175,55,0.45)] bg-[rgba(212,175,55,0.1)] text-sm font-bold text-gold">GM</span>
            <span className="text-sm font-bold tracking-[0.12em] text-paper">GM CRYPTO ARBITRAGE AI</span>
          </div>

          <div className="gm-card p-5 sm:p-6">
            <h2 className="text-lg font-semibold text-paper">Accedi alla dashboard</h2>
            <p className="mb-5 mt-1 text-xs text-muted">Sessione cifrata con cookie httpOnly. Nessuna chiave privata richiesta.</p>
            <LoginForm demoEmail={demoEmail} />
            <div className="mt-5 border-t pt-4 text-xs text-muted" style={{ borderColor: "var(--color-line)" }}>
              Nessun account?{" "}
              <Link href="/register" className="font-semibold text-gold hover:underline">
                Registrati (piano FREE)
              </Link>
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-[rgba(245,181,68,0.3)] bg-[rgba(245,181,68,0.07)] px-3.5 py-3 text-[11px] leading-relaxed text-warn">
            <strong className="font-semibold">Primo avvio:</strong> nessuna password è inclusa nel codice.
            <div className="mt-1 text-muted">
              L&apos;account admin ({demoEmail}) usa la password impostata in <code>GM_ADMIN_PASSWORD</code> oppure quella generata e
              stampata una sola volta nel log del server. Cambiala al primo accesso.
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
