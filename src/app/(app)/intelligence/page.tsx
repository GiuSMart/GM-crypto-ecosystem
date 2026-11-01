import IntelligenceChat from "@/components/IntelligenceChat";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead } from "@/components/ui";
import { analyse, buildSnapshot } from "@/lib/ai/intelligence";
import { requireUser } from "@/lib/auth";
import { dt } from "@/lib/format";

export const dynamic = "force-dynamic";

const toneStyles: Record<string, string> = {
  positive: "border-[rgba(61,220,151,0.3)] bg-[rgba(61,220,151,0.05)]",
  neutral: "border-[var(--color-line)] bg-white/[0.02]",
  warning: "border-[rgba(245,181,68,0.3)] bg-[rgba(245,181,68,0.05)]",
  critical: "border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.05)]",
};

const toneBadge = (tone: string) =>
  tone === "positive" ? "pos" : tone === "warning" ? "warn" : tone === "critical" ? "neg" : "neutral";

export default async function IntelligencePage() {
  const user = await requireUser();
  const snapshot = await buildSnapshot(user.id);
  const insights = analyse(snapshot);

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Intelligenza</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">GM Trading Intelligence</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            Analisi generata sui dati effettivi del database: order book appena letti, valutazioni registrate, fee configurate e risultati delle simulazioni.
            Non produce prezzi, commissioni o opportunità: le legge.
          </p>
        </div>
        <div className="text-right text-[11px] text-muted">
          <div>Snapshot: {dt(snapshot.generatedAt)}</div>
          <div className="mt-1 flex justify-end gap-1">
            <Badge tone="gold">deterministico</Badge>
            <Badge tone="neutral">zero costi AI</Badge>
          </div>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        {insights.map((insight) => (
          <div key={insight.id} className={`rounded-2xl border px-4 py-3.5 ${toneStyles[insight.tone] ?? toneStyles.neutral}`}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-paper">{insight.title}</h2>
              <Badge tone={toneBadge(insight.tone) as "pos" | "warn" | "neg" | "neutral"}>{insight.tone}</Badge>
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{insight.body}</p>
            {insight.facts.length ? (
              <dl className="mt-2 space-y-1">
                {insight.facts.map((f, i) => (
                  <div key={`${insight.id}-${i}`} className="flex items-start justify-between gap-3 text-[11px]">
                    <dt className="text-[#75757f]">{f.label}</dt>
                    <dd className="num max-w-[60%] text-right font-medium text-paper">{f.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        ))}
      </div>

      <Card className="overflow-hidden">
        <CardHead
          title="Chiedi un'analisi"
          subtitle="Risposte vincolate ai dati: se il dato non esiste, viene dichiarato"
          icon={<Icon name="brain" size={17} />}
        />
        <IntelligenceChat />
      </Card>

      <Callout tone="warn" title="Cosa questa AI non fa">
        Non prevede i prezzi, non consiglia investimenti, non genera segnali propri e non modifica le soglie. Non c&apos;è alcun modello AI esterno configurato in
        questa build: l&apos;analisi è un motore deterministico sui dati, quindi riproducibile e verificabile. Un fornitore LLM potrà essere collegato in futuro
        mantenendo lo stesso vincolo di grounding.
      </Callout>
    </div>
  );
}
