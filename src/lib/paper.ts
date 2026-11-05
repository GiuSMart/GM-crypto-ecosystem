import { newId } from "./crypto";
import { all, getUserSettings, one, run } from "./db";
import { evaluateOpportunity, walkBids } from "./engine/arbitrage";
import { calculatePaperRealizedProfit } from "./engine/paper";
import { PAPER_PNL_FORMULA_VERSION, summarizePaperPnl, type PaperPnlGroup } from "./engine/paper-analytics";
import { resolveFee } from "./engine/fees";
import { audit } from "./audit";
import { buildCostModel, getBook, opportunityById } from "./market";

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
  pnl_formula_version: number;
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
        fee_buy, fee_sell, other_costs, expected_profit, expected_margin_pct, status, opened_at, pnl_formula_version, note)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'open',?,?,?)`,
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
      // Stamped at open so the row always declares the formula family it was
      // created under; a close under the current formula promotes it to v2.
      PAPER_PNL_FORMULA_VERSION,
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
 * Realised P&L = current sell proceeds (net of sell fee and buffer) − entry spend.
 * The transfer fee was already deducted from the quantity stored at entry.
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
    const entrySpend = trade.notional + trade.fee_buy;
    // qty was persisted after deducting the withdrawal fee at entry. Do not
    // charge that same transfer fee again when marking the exit.
    const realized = calculatePaperRealizedProfit({
      exitProceeds: exit.filledQuote,
      sellFeePct: sellFee.takerPct,
      safetyBufferPct: settings.safetyBufferPct,
      entrySpend,
    });
    const realizedMargin = entrySpend > 0 ? (realized / entrySpend) * 100 : 0;

    run(
      `UPDATE paper_trades SET status = 'closed', closed_at = ?, exit_buy = ?, exit_sell = ?, realized_profit = ?, realized_margin_pct = ?,
         pnl_formula_version = ?
       WHERE id = ? AND user_id = ?`,
      new Date().toISOString(),
      trade.buy_vwap,
      round(exit.avgPrice),
      round(realized),
      round(realizedMargin, 6),
      // The stored result is now produced by the current formula, whatever the
      // trade was stamped with at open, so it joins the comparable series.
      PAPER_PNL_FORMULA_VERSION,
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

/**
 * Paper statistics split by the formula that produced each result.
 * `comparable` is the official series; `legacy` stays visible for transparency
 * and is never added to it. A figure that mixes the two would be arithmetically
 * valid and financially meaningless.
 */
export type PaperStats = {
  openCount: number;
  openExpectedTotal: number;
  closedCount: number;
  comparable: PaperPnlGroup;
  legacy: PaperPnlGroup;
  unknownResultCount: number;
};

export function paperStats(userId: string): PaperStats {
  const rows = all<PaperTradeRow>("SELECT * FROM paper_trades WHERE user_id = ?", userId);
  const open = rows.filter((r) => r.status === "open");
  const summary = summarizePaperPnl(
    rows.map((r) => ({
      status: r.status,
      // A row whose version cannot be read is historical, never official.
      formulaVersion: r.pnl_formula_version ?? null,
      expectedProfit: r.expected_profit,
      realizedProfit: r.realized_profit ?? Number.NaN,
      realizedMarginPct: r.realized_margin_pct,
    })),
  );
  return {
    openCount: open.length,
    openExpectedTotal: open.reduce((s, r) => s + r.expected_profit, 0),
    closedCount: summary.comparable.closedCount + summary.legacy.closedCount,
    comparable: summary.comparable,
    legacy: summary.legacy,
    unknownResultCount: summary.unknownResultCount,
  };
}
