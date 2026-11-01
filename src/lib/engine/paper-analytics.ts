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
