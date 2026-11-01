/**
 * Pure arbitrage mathematics.
 *
 * Everything here is a deterministic function of its inputs: no network, no
 * clock except the explicit `now` parameter, no randomness. That makes the
 * "NO PROFIT = NO TRADE" rule testable and auditable.
 *
 * Cost model (conservative on purpose):
 *   gross   = sell proceeds at the depth-weighted bid VWAP
 *   fees    = taker fee charged on the quote amount of each leg
 *   transfer= on-chain withdrawal fee of the bought asset, priced at the sale VWAP
 *   buffer  = additional haircut on proceeds for latency/fill risk
 *   net     = (proceeds - sellFee - transfer - buffer) - (spend + buyFee)
 */

export type Level = { price: number; size: number };

export type Book = {
  venue: string;
  pair: string;
  bids: Level[]; // descending price
  asks: Level[]; // ascending price
  /** Local receive timestamp in ms (used for staleness checks). */
  ts: number;
};

export type CostModel = {
  buyFeePct: number;
  sellFeePct: number;
  transferMode: "prefunded" | "transfer";
  /** Withdrawal fee expressed in units of the base asset. null = not configured. */
  networkFeeInBase: number | null;
  safetyBufferPct: number;
  maxSlippagePct: number;
  minMarginPct: number;
  maxDataAgeMs: number;
  minNotionalQuote: number;
};

export type WalkResult = {
  filledBase: number;
  filledQuote: number;
  avgPrice: number;
  /** True when the requested size was completely filled from available depth. */
  complete: boolean;
  worstPrice: number;
  levelsUsed: number;
};

/** Spend `quoteBudget` of quote currency walking the ask ladder upwards. */
export function walkAsks(asks: Level[], quoteBudget: number): WalkResult {
  let remaining = quoteBudget;
  let base = 0;
  let spent = 0;
  let worst = 0;
  let used = 0;
  for (const level of asks) {
    if (remaining <= 1e-9) break;
    const { price, size } = level;
    if (!(price > 0) || !(size > 0)) continue;
    const capacity = price * size;
    const spend = Math.min(remaining, capacity);
    base += spend / price;
    spent += spend;
    worst = price;
    used += 1;
    remaining -= spend;
  }
  return {
    filledBase: base,
    filledQuote: spent,
    avgPrice: base > 0 ? spent / base : 0,
    complete: quoteBudget > 0 && remaining <= Math.max(1e-6, quoteBudget * 1e-9),
    worstPrice: worst,
    levelsUsed: used,
  };
}

/** Sell `baseQty` of base currency walking the bid ladder downwards. */
export function walkBids(bids: Level[], baseQty: number): WalkResult {
  let remaining = baseQty;
  let base = 0;
  let proceeds = 0;
  let worst = 0;
  let used = 0;
  for (const level of bids) {
    if (remaining <= 1e-12) break;
    const { price, size } = level;
    if (!(price > 0) || !(size > 0)) continue;
    const qty = Math.min(remaining, size);
    base += qty;
    proceeds += qty * price;
    worst = price;
    used += 1;
    remaining -= qty;
  }
  return {
    filledBase: base,
    filledQuote: proceeds,
    avgPrice: base > 0 ? proceeds / base : 0,
    complete: baseQty > 0 && remaining <= Math.max(1e-12, baseQty * 1e-9),
    worstPrice: worst,
    levelsUsed: used,
  };
}

/** Total quote notional resting on one side, within a max slippage from the top. */
export function depthWithinSlippage(levels: Level[], maxSlippagePct: number): number {
  if (!levels.length) return 0;
  const top = levels[0].price;
  if (!(top > 0)) return 0;
  let total = 0;
  for (const { price, size } of levels) {
    if (!(price > 0) || !(size > 0)) continue;
    const deviation = Math.abs(price - top) / top * 100;
    if (deviation > maxSlippagePct) break;
    total += price * size;
  }
  return total;
}

export type Evaluation = {
  pair: string;
  buyVenue: string;
  sellVenue: string;
  notionalQuote: number;
  /** Top of book, for humans comparing with an exchange screen. */
  topAsk: number;
  topBid: number;
  /** (topBid - topAsk) / topAsk — the naive number the engine refuses to trust. */
  grossSpreadPct: number;
  /** Size actually acquired, in base units. */
  qtyBase: number;
  buyVwap: number;
  sellVwap: number;
  buySpend: number;
  sellProceeds: number;
  buyFee: number;
  sellFee: number;
  transferCost: number;
  bufferCost: number;
  /** Spread level at which net profit would be exactly zero (fees + buffer + transfer). */
  breakevenSpreadPct: number;
  netProfit: number;
  marginPct: number;
  buySlippagePct: number;
  sellSlippagePct: number;
  /** Quote notional resting within the tolerated slippage on each side. */
  buyDepthQuote: number;
  sellDepthQuote: number;
  executable: boolean;
  rejectReasons: string[];
  dataAgeMs: number;
};

export type EvaluateParams = {
  pair: string;
  buyBook: Book;
  sellBook: Book;
  notionalQuote: number;
  cost: CostModel;
  now?: number;
};

const round = (v: number, digits = 10) => Number(v.toFixed(digits));

/**
 * Full cost-aware evaluation of a two-leg arbitrage.
 *
 * Executable requires ALL of: fresh books, complete depth on both legs,
 * slippage inside tolerance, known transfer costs, strictly positive net profit
 * AND net margin at or above the configured minimum.
 */
export function evaluateOpportunity({ pair, buyBook, sellBook, notionalQuote, cost, now = Date.now() }: EvaluateParams): Evaluation {
  const reasons: string[] = [];

  const topAsk = buyBook.asks[0]?.price ?? 0;
  const topBid = sellBook.bids[0]?.price ?? 0;
  const grossSpreadPct = topAsk > 0 ? ((topBid - topAsk) / topAsk) * 100 : 0;

  const buy = walkAsks(buyBook.asks, notionalQuote);
  const sell = buy.complete ? walkBids(sellBook.bids, buy.filledBase) : { ...walkAsks([], 0), complete: false, avgPrice: 0, worstPrice: 0 };

  const buyFee = buy.filledQuote * (cost.buyFeePct / 100);
  const sellFee = sell.filledQuote * (cost.sellFeePct / 100);
  const buySpend = buy.filledQuote + buyFee;
  const proceedsAfterFee = sell.filledQuote - sellFee;

  let transferCost = 0;
  let transferPct = 0;
  if (cost.transferMode === "transfer") {
    if (cost.networkFeeInBase === null || !Number.isFinite(cost.networkFeeInBase)) {
      reasons.push("Costo di trasferimento on-chain non configurato: in modalità transfer il profitto netto non è calcolabile.");
      transferCost = Number.NaN;
    } else {
      transferCost = cost.networkFeeInBase * sell.avgPrice;
      const sellable = sell.filledBase - cost.networkFeeInBase;
      if (sellable <= 0) {
        reasons.push("La fee di rete è più grande della quantità acquisita.");
        transferCost = Number.NaN;
      }
    }
    transferPct = buySpend > 0 && Number.isFinite(transferCost) ? (transferCost / buySpend) * 100 : 0;
  }

  const bufferCost = proceedsAfterFee * (cost.safetyBufferPct / 100);
  const netProfit = proceedsAfterFee - transferCost - bufferCost - buySpend;
  const marginPct = buySpend > 0 ? (netProfit / buySpend) * 100 : 0;

  const buySlippagePct = topAsk > 0 && buy.complete ? (buy.avgPrice / topAsk - 1) * 100 : 0;
  const sellSlippagePct = topBid > 0 && sell.complete ? (1 - sell.avgPrice / topBid) * 100 : 0;

  const dataAgeMs = now - Math.min(buyBook.ts, sellBook.ts);

  const breakevenSpreadPct = round(cost.buyFeePct + cost.sellFeePct + cost.safetyBufferPct + transferPct, 6);

  if (buyBook.venue === sellBook.venue) reasons.push("Le due gambe cadono sulla stessa venue.");
  if (notionalQuote < cost.minNotionalQuote) {
    reasons.push(`Dimensione ordine sotto il minimo operativo (${cost.minNotionalQuote}).`);
  }
  if (!topAsk || !topBid) reasons.push("Order book incompleto su una delle due venue.");
  if (!buy.complete) reasons.push("Liquidità insufficiente sul book di acquisto per il notional richiesto.");
  if (!sell.complete) reasons.push("Liquidità insufficiente sul book di vendita per la quantità acquisita.");
  if (buy.complete && buySlippagePct > cost.maxSlippagePct) {
    reasons.push(`Slippage in acquisto ${buySlippagePct.toFixed(3)}% oltre la tolleranza ${cost.maxSlippagePct}%.`);
  }
  if (sell.complete && sellSlippagePct > cost.maxSlippagePct) {
    reasons.push(`Slippage in vendita ${sellSlippagePct.toFixed(3)}% oltre la tolleranza ${cost.maxSlippagePct}%.`);
  }
  if (dataAgeMs > cost.maxDataAgeMs) {
    reasons.push(`Dati non aggiornati (${Math.round(dataAgeMs)}ms > ${cost.maxDataAgeMs}ms).`);
  }
  if (Number.isFinite(netProfit) && netProfit <= 0) {
    reasons.push("NO PROFIT = NO TRADE: il profitto netto dopo tutte le fee è nullo o negativo.");
  }
  if (Number.isFinite(marginPct) && netProfit > 0 && marginPct < cost.minMarginPct) {
    reasons.push(`Margine netto ${marginPct.toFixed(3)}% sotto la soglia minima ${cost.minMarginPct}%.`);
  }

  return {
    pair,
    buyVenue: buyBook.venue,
    sellVenue: sellBook.venue,
    notionalQuote,
    topAsk: round(topAsk),
    topBid: round(topBid),
    grossSpreadPct: round(grossSpreadPct, 6),
    qtyBase: round(buy.filledBase),
    buyVwap: round(buy.avgPrice),
    sellVwap: round(sell.avgPrice),
    buySpend: round(buySpend),
    sellProceeds: round(sell.filledQuote),
    buyFee: round(buyFee),
    sellFee: round(sellFee),
    transferCost: Number.isFinite(transferCost) ? round(transferCost) : Number.NaN,
    bufferCost: round(bufferCost),
    breakevenSpreadPct,
    netProfit: Number.isFinite(netProfit) ? round(netProfit) : Number.NaN,
    marginPct: Number.isFinite(marginPct) ? round(marginPct, 6) : Number.NaN,
    buySlippagePct: round(buySlippagePct, 6),
    sellSlippagePct: round(sellSlippagePct, 6),
    buyDepthQuote: round(depthWithinSlippage(buyBook.asks, cost.maxSlippagePct)),
    sellDepthQuote: round(depthWithinSlippage(sellBook.bids, cost.maxSlippagePct)),
    executable: reasons.length === 0,
    rejectReasons: reasons,
    dataAgeMs: Math.max(0, Math.round(dataAgeMs)),
  };
}

/**
 * Try several order sizes and keep the one with the best net margin.
 * Small size can be profitable while a large one destroys the edge through
 * depth, which is exactly the effect a naive spread monitor misses.
 */
export function bestSize(
  params: Omit<EvaluateParams, "notionalQuote">,
  baseNotional: number,
  factors = [0.25, 0.5, 1, 1.5, 2],
): { best: Evaluation; curve: Evaluation[] } {
  const curve = factors.map((f) =>
    evaluateOpportunity({ ...params, notionalQuote: round(baseNotional * f, 2) }),
  );
  const executable = curve.filter((c) => c.executable);
  const pool = executable.length ? executable : curve;
  const best = pool.reduce((a, b) => (b.marginPct > a.marginPct ? b : a));
  return { best, curve };
}

export const NO_TRADE_RULE = "NO PROFIT = NO TRADE";
