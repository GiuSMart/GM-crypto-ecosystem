export type PaperRealizedProfitParams = {
  exitProceeds: number;
  sellFeePct: number;
  safetyBufferPct: number;
  entrySpend: number;
};

/**
 * Mark-to-market P&L for a paper position.
 * The entry quantity is already net of any withdrawal fee, so the transfer
 * cost must not be deducted again at exit.
 */
export function calculatePaperRealizedProfit({
  exitProceeds,
  sellFeePct,
  safetyBufferPct,
  entrySpend,
}: PaperRealizedProfitParams): number {
  const sellFee = exitProceeds * (sellFeePct / 100);
  const buffer = exitProceeds * (safetyBufferPct / 100);
  return exitProceeds - sellFee - buffer - entrySpend;
}
