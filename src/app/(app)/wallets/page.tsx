import { Mutate } from "@/components/ActionButtons";
import { WalletForm } from "@/components/InfraForms";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead, Empty } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { VENUES } from "@/lib/config";
import { all } from "@/lib/db";
import { ago } from "@/lib/format";

export const dynamic = "force-dynamic";

type WalletRow = { id: string; platform: string; label: string; address: string; chain: string | null; mode: string; created_at: string };

export default async function WalletsPage() {
  const user = await requireUser();
  const wallets = all<WalletRow>("SELECT * FROM wallets WHERE user_id = ? ORDER BY created_at DESC", user.id);
  const platforms = VENUES.filter((v) => v.kind !== "exchange").map((v) => ({ id: v.id, name: v.name }));

  return (
    <div className="space-y-4">
      <header>
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Infrastruttura</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Wallet collegati</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          Solo indirizzi pubblici, in modalità watch. Nessuna chiave privata, nessuna seed phrase: se un servizio te la chiede, è una truffa. I wallet non
          partecipano al motore di arbitraggio, che richiede order book (quindi exchange).
        </p>
      </header>

      <Card>
        <CardHead
          title={`I tuoi wallet (${wallets.length})`}
          subtitle="Registro locale, cifrato nel database con gli altri dati dell'account"
          icon={<Icon name="wallet" size={17} />}
        />
        {wallets.length ? (
          <div className="gm-scroll-x">
            <table className="gm-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Piattaforma</th>
                  <th>Indirizzo</th>
                  <th>Rete</th>
                  <th>Modalità</th>
                  <th>Aggiunto</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {wallets.map((w) => (
                  <tr key={w.id}>
                    <td className="font-medium text-paper">{w.label}</td>
                    <td className="text-[11px] text-muted">{VENUES.find((v) => v.id === w.platform)?.name ?? w.platform}</td>
                    <td className="font-mono text-[11px] text-muted">{w.address}</td>
                    <td className="text-[11px] text-muted">{w.chain ?? "—"}</td>
                    <td>
                      <Badge tone="gold">{w.mode}</Badge>
                    </td>
                    <td className="text-[11px] text-muted">{ago(w.created_at)}</td>
                    <td className="text-right">
                      <Mutate url={`/api/wallets?id=${w.id}`} method="DELETE" label="Rimuovi" confirmText="Rimuovere questo wallet dal registro?" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Nessun wallet registrato" body="Aggiungi un indirizzo pubblico per tenere traccia dell'inventario fuori dagli exchange." />
        )}
        <div className="border-t" style={{ borderColor: "var(--color-line)" }}>
          <WalletForm platforms={platforms} />
        </div>
      </Card>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card className="px-4 py-4">
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Cosa è realmente possibile</h3>
          <ul className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted">
            <li>
              <span className="font-semibold text-paper">Phantom</span> — self-custody. I saldi richiedono l&apos;approvazione dell&apos;utente tramite Phantom
              Connect/injected provider; non esiste un&apos;API hostata che legga il tuo saldo senza firma. I nuovi accessi a Phantom Portal sono attualmente
              sospesi secondo la documentazione ufficiale.
            </li>
            <li>
              <span className="font-semibold text-paper">Wirex</span> — nessuna API self-service per il conto personale. Wirex Pay Partner API e Open Banking sono
              riservati a partner (onboarding commerciale/regolatorio).
            </li>
            <li>
              <span className="font-semibold text-paper">Speed</span> — API merchant per pagamenti, payout e saldo, non un order book.
            </li>
            <li>
              <span className="font-semibold text-paper">Crypto Voucher</span> — voucher prepagati; API riservata ai partner, nessun book.
            </li>
          </ul>
        </Card>
        <Callout tone="warn" title="Perché non leggiamo i saldi in automatico">
          Farlo richiederebbe chiavi private o account partner, entrambe cose che questo prodotto non accetta. Preferiamo dichiarare il limite: gli indirizzi
          servono come registro dell&apos;inventario usato nel modello prefunded, non come sostituto di un&apos;integrazione bancaria che non esiste.
        </Callout>
      </div>
    </div>
  );
}
