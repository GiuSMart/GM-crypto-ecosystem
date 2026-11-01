import MarketLive from "@/components/MarketLive";
import { Icon } from "@/components/icons";
import { Badge, Callout, Card, CardHead, Empty } from "@/components/ui";
import { ARBITRAGE_VENUES, VENUE_MAP, type Quote } from "@/lib/config";
import { requireUser } from "@/lib/auth";
import { getUserSettings } from "@/lib/db";
import { getBoard, pairUniverse, type Board } from "@/lib/market";

export const dynamic = "force-dynamic";

export default async function MarketsPage() {
  const user = await requireUser();
  const settings = getUserSettings(user.id);
  const quote = settings.quote as Quote;

  let board: Board = { quote, ts: 0, rows: [], errors: [] };
  try {
    board = await getBoard(quote);
  } catch (err) {
    board.errors.push((err as Error).message);
  }
  const universe = await pairUniverse(quote);

  return (
    <div className="space-y-4">
      <header>
        <div className="text-[11px] uppercase tracking-[0.16em] text-muted">Mercati</div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-paper">Prezzi in tempo reale</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
          Coppie comuni tra le venue collegate, lette dalle API pubbliche (nessuna credenziale). Il confronto mostra il miglior ask e il miglior bid per ogni
          asset: la differenza è lo spread lordo, che <strong className="text-paper">non è ancora un profitto</strong>.
        </p>
      </header>

      <Card className="overflow-hidden">
        <CardHead
          title={`Board ${quote}`}
          subtitle={`${board.rows.length} coppie con book su almeno due venue`}
          icon={<Icon name="chart" size={17} />}
          action={<Badge tone="gold">aggiornamento 6s</Badge>}
        />
        <MarketLive initial={board} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHead title="Coppie monitorate" subtitle="Intersezione reale delle coppie pubblicate dalle venue" icon={<Icon name="layers" size={17} />} />
          {universe.length ? (
            <div className="gm-scroll-x">
              <table className="gm-table">
                <thead>
                  <tr>
                    <th>Coppia</th>
                    <th>Venue con book</th>
                  </tr>
                </thead>
                <tbody>
                  {universe.map((u) => (
                    <tr key={u.pair}>
                      <td className="font-medium text-paper">{u.pair}</td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {u.venues.map((v) => (
                            <span key={v} className="gm-badge">
                              {VENUE_MAP[v]?.name ?? v}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Nessuna coppia comune" body="Le venue non hanno restituito coppie sovrapposte per questa valuta di quotazione." />
          )}
        </Card>

        <Card>
          <CardHead title="Sorgenti e limiti" subtitle="Perché il refresh non è più aggressivo" icon={<Icon name="shield" size={17} />} />
          <ul className="space-y-2.5 px-4 py-4 text-[11px] leading-relaxed text-muted">
            {ARBITRAGE_VENUES.map((id) => {
              const v = VENUE_MAP[id];
              return (
                <li key={id}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-paper">{v.name}</span>
                    <Badge tone="pos">pubblico</Badge>
                  </div>
                  <p className="mt-1">{v.rateLimitNote}</p>
                  <a href={v.apiDocs} target="_blank" rel="noreferrer noopener" className="mt-1 inline-block text-gold hover:underline">
                    Documentazione ufficiale ↗
                  </a>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <Callout tone="neutral" title="Come leggere il board">
        Il board serve a capire quanto i mercati sono allineati. Il motore entra in azione solo sulle coppie con lo spread più ampio: scarica gli order book
        completi, calcola il VWAP di profondità e verifica se il netto supera la soglia. Fai una scansione dalla Panoramica per vedere gli esiti reali.
      </Callout>
    </div>
  );
}
