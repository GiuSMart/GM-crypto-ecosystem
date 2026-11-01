import { newId } from "./crypto";
import { all, getUserSettings, one, run } from "./db";
import { evaluateOpportunity, walkBids } from "./engine/arbitrage";
import { resolveFee } from "./engine/fees";
import { audit } from "./audit";
import { buildCostModel, getBook, opportunityById } from "./market";
import { getNetworkFees } from "./network-fees";

export type PaperTradeRow = {
  id: string;
  user_id: string;
  opportunity_id: string | null;
  pair: string;
  buy_venue: string;
  sell_venue: string;
  notional: number;
  qty: number;
  buy_vwap: number;
  sell_vwap: number;
  fee_buy: number;
  fee_sell: number;
  other_costs: number;
  expected_profit: number;
  expected_margin_pct: number;
  status: "open" | "closed";
  opened_at: string;
  closed_at: string | null;
  exit_buy: number | null;
  exit_sell: number | null;
  realized_profit: number | null;
  realized_margin_pct: number | null;
  note: string | null;
};

const round = (v: number, d = 8) => (Number.isFinite(v) ? Number(v.toFixed(d)) : v);

export type OpenResult = { ok: true; id: string; expectedProfit: number; marginPct: number } | { ok: false; error: string; reasons?: string[] };

/**
 * Open a simulated round trip from a stored opportunity.
 * The trade is refused unless the signal is executable right now under the
 * user's own thresholds — paper trading never pretends a losing trade is fine.
 */
export async function openPaperTrade(userId: string, opportunityId: string, ip: string | null = null): Promise<OpenResult> {
  const opp = opportunityById(opportunityId);
  if (!opp) return { ok: false, error: "Opportunità non trovata." };

  const settings = getUserSettings(userId);
  const [baseAsset] = opp.pair.split("/");
  const buyFee = resolveFee(opp.buy_venue, userId);
  const sellFee = resolveFee(opp.sell_venue, userId);
  if (!buyFee || !sellFee) return { ok: false, error: "Commissioni non configurate per una delle due venue." };

  try {
    const [buyBook, sellBook] = await Promise.all([getBook(opp.buy_venue, opp.pair), getBook(opp.sell_venue, opp.pair)]);
    const cost = buildCostModel(settings, buyFee.takerPct, sellFee.takerPct, baseAsset);
    const evaluation = evaluateOpportunity({
      pair: opp.pair,
      buyBook,
      sellBook,
      notionalQuote: opp.notional,
      cost,
    });
    if (!evaluation.executable) {
      return {
        ok: false,
        error: "Il segnale non è più eseguibile con i dati attuali.",
        reasons: evaluation.rejectReasons,
      };
    }

    const id = newId("pt");
    const transferCost = Number.isFinite(evaluation.transferCost) ? evaluation.transferCost : 0;
    run(
      `INSERT INTO paper_trades(id, user_id, opportunity_id, pair, buy_venue, sell_venue, notional, qty, buy_vwap, sell_vwap,
        fee_buy, fee_sell, other_costs, expected_profit, expected_margin_pct, status, opened_at, note)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?)`,
      id,
      userId,
      opportunityId,
      evaluation.pair,
      evaluation.buyVenue,
      evaluation.sellVenue,
      evaluation.notionalQuote,
      round(evaluation.qtyBase),
      evaluation.buyVwap,
      evaluation.sellVwap,
      round(evaluation.buyFee),
      round(evaluation.sellFee),
      round(transferCost + evaluation.bufferCost),
      round(evaluation.netProfit),
      round(evaluation.marginPct, 6),
      new Date().toISOString(),
      `Paper trade — margine atteso ${evaluation.marginPct.toFixed(3)}%`,
    );
    audit(userId, "paper.open", id, { pair: evaluation.pair, notional: evaluation.notionalQuote }, ip);
    return { ok: true, id, expectedProfit: evaluation.netProfit, marginPct: evaluation.marginPct };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export type CloseResult = { ok: true; realizedProfit: number; realizedMarginPct: number } | { ok: false; error: string };

/**
 * Close a paper trade by marking the exit leg against the live bid ladder.
 * Realised P&L = current sell proceeds (net of fee, buffer and transfer) − entry spend.
 */
export async function closePaperTrade(userId: string, tradeId: string, ip: string | null = null): Promise<CloseResult> {
  const trade = one<PaperTradeRow>("SELECT * FROM paper_trades WHERE id = ? AND user_id = ?", tradeId, userId);
  if (!trade) return { ok: false, error: "Operazione non trovata." };
  if (trade.status === "closed") return { ok: false, error: "Operazione già chiusa." };

  const settings = getUserSettings(userId);
  const sellFee = resolveFee(trade.sell_venue, userId);
  if (!sellFee) return { ok: false, error: "Commissioni di vendita non configurate." };

  try {
    const book = await getBook(trade.sell_venue, trade.pair);
    const exit = walkBids(book.bids, trade.qty);
    if (!exit.complete) return { ok: false, error: "Profondità insufficiente per chiudere al prezzo di mercato." };

    const feeSell = exit.filledQuote * (sellFee.takerPct / 100);
    const buffer = exit.filledQuote * (settings.safetyBufferPct / 100);
    let transfer = 0;
    if (settings.transferMode === "transfer") {
      const network = getNetworkFees()[trade.pair.split("/")[0]];
      if (network?.feeInBase == null) {
        return { ok: false, error: "Modalità transfer attiva ma fee di rete non configurata: chiusura bloccata." };
      }
      transfer = network.feeInBase * exit.avgPrice;
    }

    const entrySpend = trade.notional + trade.fee_buy;
    const realized = exit.filledQuote - feeSell - buffer - transfer - entrySpend;
    const realizedMargin = entrySpend > 0 ? (realized / entrySpend) * 100 : 0;

    run(
      `UPDATE paper_trades SET status = 'closed', closed_at = ?, exit_buy = ?, exit_sell = ?, realized_profit = ?, realized_margin_pct = ?
       WHERE id = ? AND user_id = ?`,
      new Date().toISOString(),
      trade.buy_vwap,
      round(exit.avgPrice),
      round(realized),
      round(realizedMargin, 6),
      tradeId,
      userId,
    );
    audit(userId, "paper.close", tradeId, { realized: round(realized) }, ip);
    return { ok: true, realizedProfit: realized, realizedMarginPct: realizedMargin };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function listPaperTrades(userId: string, limit = 100): PaperTradeRow[] {
  return all<PaperTradeRow>("SELECT * FROM paper_trades WHERE user_id = ? ORDER BY opened_at DESC LIMIT ?", userId, limit);
}

export type PaperStats = {
  openCount: number;
  closedCount: number;
  expectedTotal: number;
  realizedTotal: number;
  wins: number;
  losses: number;
  winRate: number | null;
  avgRealizedMarginPct: number | null;
  openExpectedTotal: number;
};

export function paperStats(userId: string): PaperStats {
  const rows = all<PaperTradeRow>("SELECT * FROM paper_trades WHERE user_id = ?", userId);
  const open = rows.filter((r) => r.status === "open");
  const closed = rows.filter((r) => r.status === "closed");
  const realizedTotal = closed.reduce((s, r) => s + (r.realized_profit ?? 0), 0);
  const wins = closed.filter((r) => (r.realized_profit ?? 0) > 0).length;
  const losses = closed.filter((r) => (r.realized_profit ?? 0) <= 0).length;
  return {
    openCount: open.length,
    closedCount: closed.length,
    expectedTotal: open.reduce((s, r) => s + r.expected_profit, 0),
    realizedTotal,
    wins,
    losses,
    winRate: closed.length ? (wins / closed.length) * 100 : null,
    avgRealizedMarginPct: closed.length
      ? closed.reduce((s, r) => s + (r.realized_margin_pct ?? 0), 0) / closed.length
      : null,
    openExpectedTotal: open.reduce((s, r) => s + r.expected_profit, 0),
  };
}
