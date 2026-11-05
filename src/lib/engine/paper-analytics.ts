export type PaperPerformance = {
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
};

/**
 * Derive closed-trade performance from finite net P&L values.
 * Break-even trades count in the win-rate denominator, but are neither wins
 * nor losses for profit-factor and average-trade calculations.
 */
export function calculatePaperPerformance(values: number[]): PaperPerformance {
  const profits = values.filter(Number.isFinite);
  const winningProfits = profits.filter((value) => value > 0);
  const losingProfits = profits.filter((value) => value < 0);
  const grossWins = winningProfits.reduce((sum, value) => sum + value, 0);
  const grossLosses = Math.abs(losingProfits.reduce((sum, value) => sum + value, 0));

  return {
    wins: winningProfits.length,
    losses: losingProfits.length,
    winRate: profits.length ? (winningProfits.length / profits.length) * 100 : null,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : null,
    averageWin: winningProfits.length ? grossWins / winningProfits.length : null,
    averageLoss: losingProfits.length ? -grossLosses / losingProfits.length : null,
    bestTrade: profits.length ? Math.max(...profits) : null,
    worstTrade: profits.length ? Math.min(...profits) : null,
  };
}


export type PaperExpectationComparison = {
  expectedTotal: number;
  realizedTotal: number;
  delta: number;
  realizationPct: number | null;
};

/** Compare the opening estimate with the final net result for closed simulations only. */
export function comparePaperExpectedToRealized(
  trades: { expectedProfit: number; realizedProfit: number }[],
): PaperExpectationComparison {
  const valid = trades.filter(
    (trade) => Number.isFinite(trade.expectedProfit) && Number.isFinite(trade.realizedProfit),
  );
  const expectedTotal = valid.reduce((sum, trade) => sum + trade.expectedProfit, 0);
  const realizedTotal = valid.reduce((sum, trade) => sum + trade.realizedProfit, 0);

  return {
    expectedTotal,
    realizedTotal,
    delta: realizedTotal - expectedTotal,
    realizationPct: expectedTotal > 0 ? (realizedTotal / expectedTotal) * 100 : null,
  };
}

/* -------------------------------------------------------------------------- */
/* P&L formula versioning                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The formula currently used to close a paper trade: the withdrawal fee is
 * already removed from the entry quantity, so it is charged exactly once.
 */
export const PAPER_PNL_FORMULA_VERSION = 2 as const;

/**
 * Trades closed before that correction charged the same withdrawal fee twice on
 * exit. Their stored results are kept untouched and are never mixed with the
 * comparable ones: a result produced by a different formula is a different
 * measurement, not an older data point of the same series.
 */
export const LEGACY_PAPER_PNL_FORMULA_VERSION = 1 as const;

export type PaperPnlVersion = typeof PAPER_PNL_FORMULA_VERSION | "legacy";

export type PaperPnlGroup = {
  formulaVersion: PaperPnlVersion;
  closedCount: number;
  expectedTotal: number;
  realizedTotal: number;
  delta: number;
  realizationPct: number | null;
  wins: number;
  losses: number;
  winRate: number | null;
  avgRealizedMarginPct: number | null;
  profitFactor: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  bestTrade: number | null;
  worstTrade: number | null;
};

export type PaperPnlInput = {
  status: string;
  formulaVersion: number | null;
  expectedProfit: number;
  realizedProfit: number;
  realizedMarginPct: number | null;
};

export type PaperPnlSummary = {
  comparable: PaperPnlGroup;
  legacy: PaperPnlGroup;
  /** Closed rows dropped from every aggregate because their result is not a finite number. */
  unknownResultCount: number;
};

/**
 * Fail closed: only the current version is official. A missing, legacy or
 * unrecognised version is historical data, never part of the comparable total.
 */
export function classifyPaperPnlVersion(version: number | null): PaperPnlVersion {
  return version === PAPER_PNL_FORMULA_VERSION ? PAPER_PNL_FORMULA_VERSION : "legacy";
}

const averageOf = (values: number[]): number | null =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

/** Aggregate one already-selected set of closed trades. Nothing is recomputed. */
function summarizeGroup(rows: PaperPnlInput[], formulaVersion: PaperPnlVersion): PaperPnlGroup {
  const comparison = comparePaperExpectedToRealized(
    rows.map((row) => ({ expectedProfit: row.expectedProfit, realizedProfit: row.realizedProfit })),
  );
  const performance = calculatePaperPerformance(rows.map((row) => row.realizedProfit));
  const margins = rows
    .map((row) => row.realizedMarginPct)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  return {
    formulaVersion,
    closedCount: rows.length,
    expectedTotal: comparison.expectedTotal,
    realizedTotal: comparison.realizedTotal,
    delta: comparison.delta,
    realizationPct: comparison.realizationPct,
    ...performance,
    avgRealizedMarginPct: averageOf(margins),
  };
}

/**
 * Split closed trades by the formula that produced their result.
 * Open trades belong to no group: a trade opened under the old formula joins
 * the comparable set only once it is closed with the current one.
 */
export function summarizePaperPnl(rows: PaperPnlInput[]): PaperPnlSummary {
  const closed = rows.filter((row) => row.status === "closed");
  const known = closed.filter((row) => Number.isFinite(row.realizedProfit));
  const unknownResultCount = closed.length - known.length;

  const comparable: PaperPnlInput[] = [];
  const legacy: PaperPnlInput[] = [];
  for (const row of known) {
    if (classifyPaperPnlVersion(row.formulaVersion) === PAPER_PNL_FORMULA_VERSION) comparable.push(row);
    else legacy.push(row);
  }

  return {
    comparable: summarizeGroup(comparable, PAPER_PNL_FORMULA_VERSION),
    legacy: summarizeGroup(legacy, "legacy"),
    unknownResultCount,
  };
}
