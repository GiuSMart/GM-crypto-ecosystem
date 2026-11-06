/**
 * Risk checks specific to the delta-neutral carry, on top of the Risk Guard.
 *
 * The Risk Guard answers "is this order allowed by the portfolio limits?". It cannot
 * answer the two questions that only exist for a two-leg position:
 *
 * 1. Are the legs actually balanced? A 10% oversized perpetual leg is a directional
 *    bet wearing a hedge costume.
 * 2. Which venue's market data is being used, and are we allowed to use it here?
 *
 * Both are checked here and both fail closed. Portfolio limits are not re-implemented:
 * they are delegated, so there is exactly one authority for them.
 */

import {
  evaluateRisk,
  type PortfolioState,
  type RiskPolicy,
  type RiskVerdict,
  type TradeIntent,
} from "./risk-guard";
import { marketDataDisplayDecision, type DeploymentContext } from "../venues/licensing";
import { FUNDING_CARRY_STRATEGY } from "./funding";

export type FundingRiskCode =
  | "LEG_NOTIONAL_INVALID"
  | "LEG_IMBALANCE"
  | "NEGATIVE_FUNDING"
  | "LIQUIDATION_BUFFER"
  | "LICENCE_BLOCKED";

export type FundingRiskViolation = { code: FundingRiskCode; message: string };

export type DeltaNeutralRiskInput = {
  venueId: string;
  pair: string;
  spotNotionalQuote: number;
  perpNotionalQuote: number;
  fundingRate: number;
  liquidationBufferPct: number;
  minLiquidationBufferPct: number;
  /** Maximum accepted difference between the two legs, percent of the larger leg. */
  maxImbalancePct: number;
  allowNegativeFunding: boolean;
  dataAgeMs: number;
  feeVerified: boolean;
  liquidityComplete: boolean;
  portfolio: PortfolioState;
  policy: RiskPolicy;
  /** `internal` for the operator's own analysis, `customer-facing` for any user. */
  context: DeploymentContext;
};

export type DeltaNeutralRiskResult = {
  approved: boolean;
  fundingViolations: FundingRiskViolation[];
  /** The delegated portfolio verdict, always evaluated. */
  verdict: RiskVerdict;
  /** |spot - perp| / max(legs), percent. */
  imbalancePct: number;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Evaluate a delta-neutral carry against the venue licence, the leg balance, the
 * funding direction, the liquidation buffer and the portfolio policy.
 */
export function evaluateDeltaNeutralRisk(input: DeltaNeutralRiskInput): DeltaNeutralRiskResult {
  const fundingViolations: FundingRiskViolation[] = [];

  const licence = marketDataDisplayDecision(input.venueId, input.context);
  if (!licence.allowed) {
    fundingViolations.push({ code: "LICENCE_BLOCKED", message: licence.reason });
  }

  if (
    !finite(input.spotNotionalQuote) ||
    !finite(input.perpNotionalQuote) ||
    input.spotNotionalQuote <= 0 ||
    input.perpNotionalQuote <= 0
  ) {
    fundingViolations.push({
      code: "LEG_NOTIONAL_INVALID",
      message: "Le due gambe devono avere un nozionale finito maggiore di zero: una gamba assente non è delta-neutral.",
    });
  }

  const largerLeg = Math.max(input.spotNotionalQuote, input.perpNotionalQuote);
  const imbalancePct =
    finite(largerLeg) && largerLeg > 0
      ? (Math.abs(input.spotNotionalQuote - input.perpNotionalQuote) / largerLeg) * 100
      : Number.POSITIVE_INFINITY;

  if (imbalancePct > input.maxImbalancePct) {
    fundingViolations.push({
      code: "LEG_IMBALANCE",
      message: `Squilibrio tra le gambe ${imbalancePct.toFixed(2)}% oltre il massimo ${input.maxImbalancePct}%: la posizione non è più delta-neutral.`,
    });
  }

  if (!input.allowNegativeFunding && input.fundingRate < 0) {
    fundingViolations.push({
      code: "NEGATIVE_FUNDING",
      message: `Funding negativo (${input.fundingRate}): la gamba short paga il funding, il carry non incassa.`,
    });
  }

  if (
    !finite(input.liquidationBufferPct) ||
    input.liquidationBufferPct < input.minLiquidationBufferPct
  ) {
    fundingViolations.push({
      code: "LIQUIDATION_BUFFER",
      message: `Buffer di liquidazione ${input.liquidationBufferPct}% sotto il minimo ${input.minLiquidationBufferPct}%.`,
    });
  }

  // The guard receives the larger leg: the capital at risk is never understated by
  // averaging a small spot leg with a large perpetual one.
  const intent: TradeIntent = {
    pair: input.pair,
    buyVenue: input.venueId,
    sellVenue: input.venueId,
    strategy: FUNDING_CARRY_STRATEGY,
    notionalQuote: largerLeg,
    expectedSlippagePct: 0,
    feeVerified: input.feeVerified,
    dataAgeMs: input.dataAgeMs,
    liquidityComplete: input.liquidityComplete,
    // Simulation only: this module can never express a live intent.
    mode: "paper",
  };

  const verdict = evaluateRisk({ intent, portfolio: input.portfolio, policy: input.policy });

  return {
    approved: verdict.approved && fundingViolations.length === 0,
    fundingViolations,
    verdict,
    imbalancePct,
  };
}
