import Link from "next/link";
import { PasswordChangeForm, RevokeAllSessions } from "@/components/SecurityForms";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead, Empty, KV } from "@/components/ui";
import { listAudit } from "@/lib/audit";
import { currentUser, listSessions, requireUser } from "@/lib/auth";
import { all, getUserSettings } from "@/lib/db";
import { ago, dt } from "@/lib/format";
import { activeLiveAuthorization, liveBlockers } from "@/lib/live";

export const dynamic = "force-dynamic";

const POSTURE = [
  { key: "Password", value: "scrypt con salt per-utente (N=16384, r=8)" },
  { key: "Sessioni", value: "token casuale da 32 byte, hash SHA-256 in DB, cookie httpOnly + SameSite=Lax" },
  { key: "CSRF", value: "verifica Origin/Sec-Fetch-Site su tutte le mutazioni + SameSite" },
  { key: "Rate limiting", value: "accessi 8/min per IP, mutazioni 10-30/min per utente" },
  { key: "Segreti", value: "AES-256-GCM con master key su file 0600 o variabile d'ambiente" },
  { key: "Prelievi", value: "mai richiesti: le key sono registrate come read-only con prelievi disabilitati" },
  { key: "Segregazione", value: "ogni query è filtrata per user_id: nessun accesso cross-tenant" },
  { key: "Audit", value: "login, mutazioni, scansioni, paper trade, autorizzazioni live" },
];

export default async function SecurityPage() {
  const user = await requireUser();
  const settings = getUserSettings(user.id);
  const sessions = listSessions(user.id);
  const credentials = all<{ id: string; venue_id: string }>("SELECT id, venue_id FROM credentials WHERE user_id = ?", user.id);
  const authorization = activeLiveAuthorization(user.id);
  const blockers = liveBlockers({ authorization, settings, credentialCount: credentials.length });
  const audit = listAudit(user.id, 30, false);

  return (
    <div className="space-y-4">
      <header>
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Protezioni</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Sicurezza</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          Misure realmente implementate in questa build, non promesse. Le voci marcate come mancanti sono elencate apertamente più sotto.
        </p>
      </header>

      <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
        <Card>
          <CardHead title="Postura di sicurezza" subtitle="Cosa è attivo nel codice" icon={<Icon name="shield" size={17} />} />
          <KV rows={POSTURE.map((p) => ({ k: p.key, v: p.value }))} />
        </Card>

        <Card>
          <CardHead
            title="Modalità C · Live trading"
            subtitle="Bloccata per progetto"
            icon={<Icon name="lock" size={17} />}
            action={<Badge tone="warn">locked</Badge>}
          />
          <div className="space-y-2 px-4 py-3">
            <div className="text-[11px] text-muted">
              Autorizzazione amministratore: <span className={authorization ? "text-pos" : "text-warn"}>{authorization ? `attiva dal ${dt(authorization.granted_at)}` : "assente"}</span>
            </div>
            {authorization ? (
              <div className="text-[11px] text-muted">
                Limiti: ordine max {authorization.max_order_quote} · perdita giornaliera max {authorization.max_daily_loss_quote}
              </div>
            ) : null}
            <ul className="space-y-1.5">
              {blockers.map((b) => (
                <li key={b} className="flex gap-1.5 text-[11px] leading-relaxed text-muted">
                  <Icon name="lock" size={12} className="mt-0.5 shrink-0 text-warn" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
            {user.role === "admin" ? (
              <Link href="/admin" className="inline-block text-[11px] text-gold hover:underline">
                Gestisci autorizzazioni (amministrazione) →
              </Link>
            ) : null}
          </div>
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="Cambia password" subtitle="Revoca tutte le altre sessioni" icon={<Icon name="lock" size={17} />} />
          <PasswordChangeForm />
        </Card>
        <Card>
          <CardHead title="Sessioni attive" subtitle={`${sessions.filter((s) => !s.revoked && s.expires_at > Date.now()).length} valide`} icon={<Icon name="users" size={17} />} />
          <div className="gm-scroll-x">
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Creata</th>
                  <th>Scade</th>
                  <th>IP</th>
                  <th>Stato</th>
                </tr>
              </thead>
              <tbody>
                {sessions.slice(0, 8).map((s) => (
                  <tr key={s.id}>
                    <td className="text-[11px] text-muted">{ago(s.created_at)}</td>
                    <td className="text-[11px] text-muted">{dt(new Date(s.expires_at))}</td>
                    <td className="font-mono text-[10px] text-muted">{s.ip ?? "—"}</td>
                    <td>
                      <Badge tone={s.revoked || s.expires_at <= Date.now() ? "neutral" : "pos"}>
                        {s.revoked ? "revocata" : s.expires_at <= Date.now() ? "scaduta" : "attiva"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t" style={{ borderColor: "var(--color-line)" }}>
            <RevokeAllSessions />
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHead title="Attività recente" subtitle="Ultimi eventi del tuo account" icon={<Icon name="history" size={17} />} />
        {audit.length ? (
          <div className="gm-scroll-x">
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Azione</th>
                  <th>Target</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className="text-[11px] text-muted">{dt(a.ts)}</td>
                    <td className="text-[11px] font-medium text-paper">{a.action}</td>
                    <td className="max-w-[180px] truncate text-[11px] text-muted">{a.target ?? "—"}</td>
                    <td className="font-mono text-[10px] text-muted">{a.ip ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nessun evento" />
        )}
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Callout tone="pos" title="Cosa è implementato e verificato">
          Hash delle password, sessioni revocabili, cookie httpOnly, controllo same-origin, rate limiting, cifratura AES-GCM delle API key, segregazione delle
          query per utente, audit log, blocco dei prelievi, assenza totale di seed phrase. I test del motore coprono la regola NO PROFIT = NO TRADE.
        </Callout>
        <Callout tone="neg" title="Cosa manca (dichiarato)">
          Nessun 2FA, nessun backup automatico pianificato, nessun WAF/reverse proxy incluso, rate limiting in memoria (non distribuito), nessuna cifratura
          at-rest del file SQLite oltre ai segreti applicativi. Per la produzione servono HTTPS, backup gestiti, 2FA e un limiter condiviso (Redis).
        </Callout>
      </div>

      <Callout tone="warn" title="Credenziali iniziali">
        Le password degli account seed non sono nel codice: derivano da <code>GM_ADMIN_PASSWORD</code> / <code>GM_DEMO_PASSWORD</code> oppure sono
        generate al primo avvio e stampate una sola volta nel log del server. Cambiale qui sopra, in un minuto, prima di esporre l&apos;istanza.
      </Callout>
    </div>
  );
}
