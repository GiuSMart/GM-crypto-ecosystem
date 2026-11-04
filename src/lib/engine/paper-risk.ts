import type { EngineSettings } from "../config";
import type { Evaluation } from "./arbitrage";
import { DEFAULT_RISK_POLICY, evaluateRisk, type RiskVerdict } from "./risk-guard";

export type OpenPaperPosition = {
  notional: number;
  buy_venue: string;
  sell_venue: string;
};

export type ClosedPaperPosition = {
  realized_profit: number | null;
  closed_at: string | null;
};

type PaperRiskEvaluation = Pick<
  Evaluation,
  "pair" | "buyVenue" | "sellVenue" | "notionalQuote" | "buySlippagePct" | "sellSlippagePct" | "dataAgeMs" | "rejectReasons"
>;

/**
 * Risk assessment for a single simulated paper portfolio.
 * The 1,000 quote-unit starting budget is virtual and never represents real balances.
 * Drawdown is based on realized paper P&L; unrealized MTM is deliberately not inferred.
 */
export function evaluatePaperRisk(input: {
  settings: EngineSettings;
  evaluation: PaperRiskEvaluation;
  buyFeeConfidence: "verified" | "unverified" | "user";
  sellFeeConfidence: "verified" | "unverified" | "user";
  openPositions: OpenPaperPosition[];
  closedPositions: ClosedPaperPosition[];
  now?: number;
}): RiskVerdict {
  const { settings, evaluation, openPositions, closedPositions } = input;
  const policy = {
    ...DEFAULT_RISK_POLICY,
    maxOrderQuote: Math.min(DEFAULT_RISK_POLICY.maxOrderQuote, settings.maxOrderQuote),
    maxDailyLossQuote: Math.min(DEFAULT_RISK_POLICY.maxDailyLossQuote, settings.maxDailyLossQuote),
    maxSlippagePct: Math.min(DEFAULT_RISK_POLICY.maxSlippagePct, settings.maxSlippagePct),
    maxDataAgeMs: Math.min(DEFAULT_RISK_POLICY.maxDataAgeMs, settings.maxDataAgeMs),
    paperModeOnly: true,
  };

  const totalExposureQuote = openPositions.reduce((sum, row) => sum + row.notional, 0);
  const venueExposureQuote: Record<string, number> = {};
  const strategyExposureQuote: Record<string, number> = {};
  for (const row of openPositions) {
    venueExposureQuote[row.buy_venue] = (venueExposureQuote[row.buy_venue] ?? 0) + row.notional;
    venueExposureQuote[row.sell_venue] = (venueExposureQuote[row.sell_venue] ?? 0) + row.notional;
    strategyExposureQuote["cross-exchange-arbitrage"] =
      (strategyExposureQuote["cross-exchange-arbitrage"] ?? 0) + row.notional;
  }

  const utcDayStart = new Date(input.now ?? Date.now());
  utcDayStart.setUTCHours(0, 0, 0, 0);
  const dailyRealizedPnlQuote = closedPositions
    .filter((row) => row.closed_at !== null && row.closed_at >= utcDayStart.toISOString())
    .reduce((sum, row) => sum + (Number.isFinite(row.realized_profit) ? row.realized_profit! : 0), 0);

  const paperBudget = policy.maxTotalExposureQuote;
  let equityQuote = paperBudget;
  let peakEquityQuote = paperBudget;
  for (const row of closedPositions) {
    const pnl = Number.isFinite(row.realized_profit) ? row.realized_profit! : 0;
    equityQuote += pnl;
    peakEquityQuote = Math.max(peakEquityQuote, equityQuote);
  }

  return evaluateRisk({
    intent: {
      pair: evaluation.pair,
      buyVenue: evaluation.buyVenue,
      sellVenue: evaluation.sellVenue,
      strategy: "cross-exchange-arbitrage",
      notionalQuote: evaluation.notionalQuote,
      expectedSlippagePct: Math.max(evaluation.buySlippagePct, evaluation.sellSlippagePct),
      feeVerified: input.buyFeeConfidence !== "unverified" && input.sellFeeConfidence !== "unverified",
      dataAgeMs: evaluation.dataAgeMs,
      liquidityComplete: !evaluation.rejectReasons.some((reason) => reason.startsWith("Liquidità insufficiente")),
      mode: "paper",
    },
    portfolio: {
      dailyRealizedPnlQuote,
      peakEquityQuote,
      equityQuote,
      totalExposureQuote,
      venueExposureQuote,
      strategyExposureQuote,
      availableCapitalQuote: Math.max(0, equityQuote - totalExposureQuote),
      systemState: settings.monitoringEnabled ? "operational" : "halted",
      emergencyStop: false,
    },
    policy,
  });
}
