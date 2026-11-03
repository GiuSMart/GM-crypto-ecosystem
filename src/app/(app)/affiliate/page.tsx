import Link from "next/link";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, Empty } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { all } from "@/lib/db";
import { dt } from "@/lib/format";
import { groupReferrals, verificationBadge } from "@/lib/referrals";

export const dynamic = "force-dynamic";

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
  accent: string | null;
  active: number;
  sort: number;
  updated_at: string;
};

export default async function AffiliatePage() {
  const user = await requireUser();
  // Ordering and grouping are decided by groupReferrals(), not by SQL: the page
  // and the admin panel must agree on the same canonical category order.
  const rows = all<RefRow>("SELECT * FROM referrals WHERE active = 1");
  const groups = groupReferrals(rows);
  const steps = (r: RefRow): string[] => {
    try {
      return JSON.parse(r.tutorial ?? "[]") as string[];
    } catch {
      return [];
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Monetizzazione</div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">GM Affiliate Center</h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
            Link referral del proprietario, ordinati per categoria e piattaforma, con tutorial e condizioni. Non dichiariamo importi o percentuali che non
            siano confermati dalla piattaforma: dove non abbiamo verifica, lo scriviamo.
          </p>
        </div>
        {user.role === "admin" ? (
          <Link href="/admin#referral" className="gm-btn text-xs">
            <Icon name="plus" size={15} /> Gestisci referral
          </Link>
        ) : null}
      </header>

      {rows.length ? (
        groups.map((group) => (
          <section key={group.category} className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">{group.category}</h2>
              <span className="h-px flex-1" style={{ backgroundColor: "var(--color-line)" }} />
              <span className="num text-[10px] text-muted">{group.items.length}</span>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {group.items.map((r) => (
                <Card key={r.id} className="flex flex-col px-4 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-paper">{r.name}</div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-muted">{r.platform}</div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge tone={verificationBadge(r).tone}>{verificationBadge(r).label}</Badge>
                      <Badge tone={r.affiliate_confirmed ? "gold" : "neutral"}>{r.affiliate_confirmed ? "affiliazione confermata" : "ricompense non dichiarate"}</Badge>
                    </div>
                  </div>

                  {r.tagline ? <p className="mt-2 text-[11px] font-medium text-gold">{r.tagline}</p> : null}
                  {r.description ? <p className="mt-1 text-[11px] leading-relaxed text-muted">{r.description}</p> : null}

                  <div className="mt-3 rounded-lg border px-2.5 py-2" style={{ borderColor: "var(--color-line)" }}>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">Come funziona</div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{r.how_it_works ?? "—"}</p>
                  </div>

                  {steps(r).length ? (
                    <ol className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted">
                      {steps(r).map((s, i) => (
                        <li key={i} className="flex gap-1.5">
                          <span className="num shrink-0 text-gold">{i + 1}.</span>
                          <span>{s}</span>
                        </li>
                      ))}
                    </ol>
                  ) : null}

                  <div className="mt-2 grid gap-1 text-[11px] leading-relaxed text-muted">
                    <p>
                      <span className="text-paper">Condizioni:</span> {r.terms ?? "non specificate"}
                    </p>
                    <p>
                      <span className="text-paper">Ricompense:</span> {r.rewards ?? "non dichiarate"}
                    </p>
                    <p className="text-[10px] text-[#686873]">Aggiornato {dt(r.updated_at)}</p>
                  </div>

                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer noopener nofollow sponsored"
                    className="gm-btn-accent mt-3 w-full py-2.5 text-xs"
                  >
                    Apri {r.platform} <Icon name="external" size={14} />
                  </a>
                </Card>
              ))}
            </div>
          </section>
        ))
      ) : (
        <Empty title="Nessun referral attivo" body="L'amministratore può aggiungere link dalla sezione Amministrazione." />
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <Callout tone="warn" title="Trasparenza sui link">
          I link sono referral: possono generare un compenso per il proprietario dell&apos;istanza. Non modifichiamo i termini delle piattaforme e non
          promettiamo bonus. Dove la ricompensa non è verificata, il badge resta “ricompense non dichiarate”.
        </Callout>
        <Callout tone="neutral" title="Referral aggiungibili senza toccare il codice">
          La tabella <code className="text-paper">referrals</code> è gestita dall&apos;interfaccia amministratore: piattaforma, nome, categoria, link e stato
          di verifica si aggiungono dalla pagina Amministrazione. L&apos;ordine delle categorie è definito in <code className="text-paper">config.ts</code>;
          i link duplicati e gli indirizzi non https vengono rifiutati. Nessun deploy necessario.
        </Callout>
      </div>

      <p className="text-[10px] leading-relaxed text-[#686873]">
        Nota: Freebuff è uno strumento di sviluppo usato internamente e non è rivenduto come parte del prodotto. Il software commercializzato è GM CRYPTO
        ARBITRAGE AI, con infrastruttura e licenze proprie.
      </p>
    </div>
  );
}
