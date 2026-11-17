import { AdminUserControls, PlanPriceRow, ReferralForm } from "@/components/AdminForms";
import { Mutate } from "@/components/ActionButtons";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead, Empty } from "@/components/ui";
import { all } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ago, dt } from "@/lib/format";
import { orderReferrals } from "@/lib/referrals";
import { listPlans, paymentsEnabled } from "@/lib/plans";

export const dynamic = "force-dynamic";

type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  role: "admin" | "client";
  plan: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
  live_authorized: number;
};

type RefRow = {
  id: string;
  platform: string;
  name: string;
  url: string;
  category: string | null;
  tagline: string | null;
  description: string | null;
  how_it_works: string | null;
  tutorial: string | null;
  terms: string | null;
  rewards: string | null;
  verified: number;
  affiliate_confirmed: number;
  active: number;
  sort: number;
  updated_at: string;
};

export default async function AdminPage() {
  const admin = await requireAdmin();
  const users = all<AdminUser>(
    `SELECT u.id, u.email, u.display_name, u.role, u.plan, u.status, u.created_at, u.last_login_at,
            (SELECT COUNT(*) FROM live_authorizations la WHERE la.user_id = u.id AND la.revoked_at IS NULL) AS live_authorized
     FROM users u ORDER BY u.created_at ASC`,
  );
  const plans = listPlans();
  // Same canonical order as the public Affiliate Center, so what the admin sees
  // in the table matches what clients will see grouped on the page.
  const referrals = orderReferrals(all<RefRow>("SELECT * FROM referrals"));
  const counts = {
    opportunities: all<{ c: number }>("SELECT COUNT(*) AS c FROM opportunities")[0]?.c ?? 0,
    scans: all<{ c: number }>("SELECT COUNT(*) AS c FROM scan_runs")[0]?.c ?? 0,
    paper: all<{ c: number }>("SELECT COUNT(*) AS c FROM paper_trades")[0]?.c ?? 0,
    credentials: all<{ c: number }>("SELECT COUNT(*) AS c FROM credentials")[0]?.c ?? 0,
    wallets: all<{ c: number }>("SELECT COUNT(*) AS c FROM wallets")[0]?.c ?? 0,
  };

  return (
    <div className="space-y-4">
      <header>
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Amministrazione · {admin.email}</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Controllo piattaforma</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          Account, piani, referral e autorizzazioni. Nessun pagamento reale è attivo finché non viene configurato un provider verificato.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "Utenti", value: users.length },
          { label: "Scansioni", value: counts.scans },
          { label: "Valutazioni", value: counts.opportunities },
          { label: "Paper", value: counts.paper },
          { label: "API key", value: counts.credentials },
        ].map((s) => (
          <div key={s.label} className="gm-card px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{s.label}</div>
            <div className="num mt-1 text-lg font-semibold text-paper">{s.value}</div>
          </div>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHead title="Account" subtitle="Piano, ruolo, stato e autorizzazione live" icon={<Icon name="users" size={17} />} />
        <div className="gm-scroll-x">
          <table className="gm-table">
            <thead>
              <tr>
                <th>Utente</th>
                <th>Ruolo</th>
                <th>Piano</th>
                <th>Stato</th>
                <th>Ultimo accesso</th>
                <th>Live</th>
                <th>Azioni</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="text-xs font-medium text-paper">{u.display_name}</div>
                    <div className="text-[10px] text-muted">{u.email}</div>
                  </td>
                  <td>
                    <Badge tone={u.role === "admin" ? "gold" : "neutral"}>{u.role}</Badge>
                  </td>
                  <td>
                    <Badge tone="neutral">{u.plan}</Badge>
                  </td>
                  <td>
                    <Badge tone={u.status === "active" ? "pos" : "neg"}>{u.status}</Badge>
                  </td>
                  <td className="text-[11px] text-muted">{u.last_login_at ? ago(u.last_login_at) : "mai"}</td>
                  <td>
                    <Badge tone={u.live_authorized ? "warn" : "neutral"}>{u.live_authorized ? "autorizzato" : "no"}</Badge>
                  </td>
                  <td>
                    {/* node:sqlite rows have a null prototype, and React refuses to hand those
                        to a Client Component: spread them into plain objects first. */}
                    <AdminUserControls user={{ ...u }} plans={plans.map((p) => ({ id: p.id, name: p.name }))} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead
            title="Piani commerciali"
            subtitle="Prezzi liberamente configurabili"
            icon={<Icon name="percent" size={17} />}
            action={<Badge tone={paymentsEnabled() ? "pos" : "warn"}>{paymentsEnabled() ? "provider configurato" : "pagamenti off"}</Badge>}
          />
          <div className="space-y-3 px-4 py-4">
            {plans.map((p) => (
              <PlanPriceRow key={p.id} plan={{ ...p }} />
            ))}
            <p className="text-[10px] leading-relaxed text-muted">
              I prezzi modificati non attivano addebiti: il flag <code className="text-paper">payments_configured</code> resta 0 finché non viene collegato un
              provider di pagamento verificato.
            </p>
          </div>
        </Card>

        <Card>
          <CardHead title="Autorizzazioni live" subtitle="Doppio consenso: interruttore admin + autorizzazione utente" icon={<Icon name="lock" size={17} />} />
          <div className="px-4 py-4 text-[11px] leading-relaxed text-muted">
            <p>
              Dalla colonna Azioni puoi autorizzare un utente specificando capitale massimo per ordine e perdita giornaliera massima. Anche con autorizzazione
              attiva, il router live resta non implementato: nessun ordine reale può partire.
            </p>
            <p className="mt-2">
              Utenti autorizzati: <span className="num text-paper">{users.filter((u) => u.live_authorized).length}</span>
            </p>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden" >
        <div id="referral" />
        <CardHead title="Referral" subtitle="Aggiungi o modifica link senza toccare il codice" icon={<Icon name="spark" size={17} />} />
        {referrals.length ? (
          <div className="gm-scroll-x">
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Piattaforma</th>
                  <th>Categoria</th>
                  <th>Link</th>
                  <th>Verificato</th>
                  <th>Attivo</th>
                  <th>Aggiornato</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="text-xs font-medium text-paper">{r.name}</div>
                      <div className="text-[10px] text-muted">{r.platform}</div>
                    </td>
                    <td className="text-[10px] text-muted">{r.category ?? "—"}</td>
                    <td className="max-w-[280px] truncate text-[10px] text-muted">{r.url}</td>
                    <td>
                      <Badge tone={r.verified ? "pos" : "warn"}>{r.verified ? "sì" : "no"}</Badge>
                    </td>
                    <td>
                      <Badge tone={r.active ? "gold" : "neutral"}>{r.active ? "attivo" : "off"}</Badge>
                    </td>
                    <td className="text-[10px] text-muted">{dt(r.updated_at)}</td>
                    <td className="text-right">
                      <Mutate url="/api/admin" body={{ action: "delete_referral", id: r.id }} label="Elimina" confirmText={`Eliminare il referral ${r.name}?`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nessun referral" body="Aggiungine uno con il modulo qui sotto." />
        )}
        <div className="border-t" style={{ borderColor: "var(--color-line)" }}>
          <ReferralForm />
        </div>
      </Card>

      <Callout tone="warn" title="Ruolo amministratore">
        L&apos;admin può cambiare piani, sospendere account e autorizzare il live. Non può però inviare ordini reali: quella funzione non esiste in questa build.
        Verifica il log attività in Sicurezza/Storico dopo ogni modifica.
      </Callout>
    </div>
  );
}
