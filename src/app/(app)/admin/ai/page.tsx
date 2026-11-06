import AiPanelForm from "@/components/AiPanelForm";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead, Empty, KV, Stat } from "@/components/ui";
import { getAiRuntime } from "@/lib/ai/runtime";
import { buildPanelStatus } from "@/lib/ai/panel";
import { ROUTE_LIMITS } from "@/lib/ai/policy";
import { DAILY_WINDOW_MS } from "@/lib/ai/quota";
import { requireAdmin } from "@/lib/auth";
import { dt } from "@/lib/format";

export const dynamic = "force-dynamic";

const stateTone = (state: "disabled" | "active" | "quota") =>
  state === "active" ? "pos" : state === "quota" ? "warn" : "neutral";

export default async function AdminAiPage() {
  // Admin only: a prompt leaves the host, so an ordinary customer session must
  // never render this page or reach the form.
  const admin = await requireAdmin();
  const ai = getAiRuntime();

  const usage = ai.store.windowUsage(`ai:user:${admin.id}`, DAILY_WINDOW_MS);
  const sharedDb = (process.env.GM_AI_SHARED_DB ?? "").trim().toLowerCase() === "true";
  const production = process.env.NODE_ENV === "production";
  const status = buildPanelStatus({
    enabled: ai.status.enabled,
    reason: ai.status.reason,
    used: usage.used,
    limit: usage.limit > 0 ? usage.limit : ROUTE_LIMITS.perUserPerDay,
    sharedDb,
    production,
    providerId: ai.status.providerId,
    modelId: ai.status.modelId,
  });
  const audit = ai.store.recentAudit(12);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Amministrazione · {admin.email}</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">GM AI Collective</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            Pannello riservato all&apos;amministratore. Invia un testo <strong className="text-paper">pubblico</strong> al provider
            gratuito approvato, con attestazione esplicita per ogni richiesta. Nessuna operazione finanziaria passa da qui.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Badge tone="gold">FREE_ONLY · EUR 0,00</Badge>
          <Badge tone={stateTone(status.state)}>{status.label}</Badge>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Stato motore" value={status.label} sub={status.detail} tone={status.state === "active" ? "pos" : status.state === "quota" ? "warn" : "neutral"} />
        <Stat label="Budget account" value={`${status.used}/${status.dailyLimit}`} sub="Richieste nella finestra giornaliera corrente" tone="neutral" />
        <Stat label="Provider" value={status.providerId} sub={status.modelId} tone="gold" />
        <Stat
          label="SQLite condiviso"
          value={status.sharedDb ? "dichiarato" : "non dichiarato"}
          sub={status.sharedDb ? "Limite globale solo con un unico file persistente" : "Non attivare in produzione senza questa garanzia"}
          tone={status.sharedDb ? "pos" : "warn"}
        />
      </div>

      {status.warnings.length > 0 ? (
        <Callout tone="warn" title="Avvisi di configurazione">
          <ul className="list-disc space-y-1 pl-4">
            {status.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </Callout>
      ) : null}

      <Callout tone="warn" title="Questa AI non tocca il trading">
        Il pannello non autorizza, non calcola e non esegue operazioni: niente ordini, prelievi, wallet o credenziali. Il motore
        deterministico e il paper trading restano separati e il router degli ordini resta un blocco intenzionale. Non inviare dati
        INTERNAL, CONFIDENTIAL o SECRET, credenziali, chiavi o dati personali: la classificazione PUBLIC non è un rilevatore
        automatico di dati sensibili, è una responsabilità dell&apos;operatore registrata nell&apos;audit.
      </Callout>

      <Card>
        <CardHead
          title="Richiesta AI"
          subtitle="Obiettivo, prompt e attestazione PUBLIC obbligatoria"
          icon={<Icon name="brain" size={17} />}
          action={<Badge tone="neutral">un tentativo per richiesta</Badge>}
        />
        <AiPanelForm />
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card>
          <CardHead title="Configurazione" subtitle="Ciò che è attivo e ciò che resta bloccato" icon={<Icon name="shield" size={17} />} />
          <KV
            rows={[
              { k: "Modalità", v: "FREE_ONLY · budget EUR 0,00" },
              { k: "Provider", v: status.providerId },
              { k: "Modello", v: status.modelId, hint: "Variante :free verificata; la risposta deve nominarla esattamente." },
              { k: "Classificazione", v: "PUBLIC forzata dal server" },
              { k: "Attestazione", v: "obbligatoria per ogni invio" },
              { k: "Limite account", v: `${status.dailyLimit} richieste/giorno` },
              { k: "Finestra condivisa", v: "18 richieste/minuto per provider" },
              { k: "SQLite condiviso", v: status.sharedDb ? "GM_AI_SHARED_DB=true" : "non dichiarato" },
              { k: "Ambiente", v: production ? "produzione" : "sviluppo/test" },
            ]}
          />
        </Card>

        <Card>
          <CardHead title="Ultimi eventi AI" subtitle="Solo metadati; nessun prompt o risposta" icon={<Icon name="history" size={17} />} />
          {audit.length === 0 ? (
            <Empty title="Nessun evento registrato" body="Il registro si popola alla prima richiesta o ai tentativi bloccati." />
          ) : (
            <div className="gm-scroll-x">
              <table className="gm-table">
                <thead>
                  <tr>
                    <th>Ora</th>
                    <th>Azione</th>
                    <th>Provider / modello</th>
                    <th>Codice</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.map((event, index) => (
                    <tr key={`${event.ts}-${index}`}>
                      <td className="whitespace-nowrap text-[11px] text-muted">{dt(event.ts)}</td>
                      <td className="text-[11px] text-paper">{event.action}</td>
                      <td className="text-[11px] text-muted">{[event.providerId, event.modelId].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="text-[11px] text-muted">{event.code ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        La quota mostrata è quella dell&apos;account <strong className="text-paper">{admin.email}</strong>. La lettura di questa
        pagina non consuma richieste. Se l&apos;AI è disattivata la route risponde 503 e nessun testo lascia l&apos;host.
      </p>
    </div>
  );
}

