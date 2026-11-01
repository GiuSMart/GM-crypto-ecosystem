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
