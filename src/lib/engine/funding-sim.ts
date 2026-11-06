/**
 * Deterministic paper simulation of the spot + perpetual carry.
 *
 * Nothing here predicts anything: the caller supplies the funding rate for each
 * period and the basis at entry and exit, and the module reports what those inputs
 * would have produced. That keeps every result reproducible and auditable, which a
 * randomly generated equity curve would not be.
 *
 * P&L decomposition:
 * - funding: short perpetual receives `rate * perpNotional` per period (negative
 *   rates therefore drain the position);
 * - basis: profit when the entry basis converges towards the exit basis;
 * - costs: taker fee plus slippage, charged on each leg at entry and at exit, on each
 *   leg's own notional (never on an average that hides an unequal hedge).
 *
 * Liquidation is modelled on the perpetual margin: the position is liquidated when
 * the margin account can no longer cover the maintenance requirement. The
 * simulation then stops at that period: no later funding is collected, the unrealized
 * basis is not paid out, and `ok` is false. A liquidated run is never a valid result.
 *
 * Model limitation, stated instead of hidden: the basis is mark-to-market only at
 * exit, so a liquidation caused by a widening basis between settlements cannot be
 * simulated with the inputs this module accepts.
 */

export type FundingCarrySimulationInput = {
  spotNotionalQuote: number;
  perpNotionalQuote: number;
  /** Basis (mark - spot) at entry, percent. */
  entryBasisPct: number;
  /** Basis at exit, percent. */
  exitBasisPct: number;
  /** Funding rate applied in each simulated interval, oldest first. */
  fundingRates: number[];
  intervalsPerDay: number;
  feePctPerLeg: number;
  slippagePctPerLeg: number;
  /** Two legs (spot + perp) are opened and later closed. */
  legsPerSide: number;
  leverage: number;
  maintenanceMarginPct: number;
};

export type FundingCarryPeriod = {
  index: number;
  /** Elapsed days after this interval. */
  day: number;
  rate: number;
  fundingPnlQuote: number;
  cumulativeFundingQuote: number;
  /** Cumulative funding minus the costs already paid (entry fees and slippage). */
  equityQuote: number;
};

export type FundingCarrySimulation = {
  ok: boolean;
  reasons: string[];
  periods: FundingCarryPeriod[];
  totalFundingQuote: number;
  /** Basis P&L actually realized: zero when the position was liquidated. */
  basisPnlQuote: number;
  costsQuote: number;
  /** Costs charged on the spot leg over entry and exit. */
  spotCostsQuote: number;
  /** Costs charged on the perpetual leg over entry and exit. */
  perpCostsQuote: number;
  netPnlQuote: number;
  /** Net P&L as a percentage of the capital the position requires. */
  netReturnPct: number;
  /** Capital locked by the strategy: spot leg plus the perpetual margin. */
  capitalRequiredQuote: number;
  maxDrawdownQuote: number;
  worstPeriodQuote: number;
  liquidated: boolean;
  /** Index of the period in which the margin was exhausted, `null` otherwise. */
  liquidationIndex: number | null;
  /** Day of the liquidation, `null` otherwise. */
  liquidationDay: number | null;
  /** Margin account left at liquidation: below the maintenance requirement. */
  equityAtLiquidationQuote: number | null;
  /** Risk capital distance: how far the perp leg can move before liquidation. */
  liquidationBufferQuote: number;
  days: number;
  /** Inputs the model does not have, stated so the result is not over-read. */
  limitations: string[];
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const LIMITATIONS = [
  "Il basis è mark-to-market solo all'uscita: una liquidazione causata da un allargamento del basis fra due settlement non è simulata.",
];

const emptyResult = (reasons: string[]): FundingCarrySimulation => ({
  ok: false,
  reasons,
  periods: [],
  totalFundingQuote: 0,
  basisPnlQuote: 0,
  costsQuote: 0,
  spotCostsQuote: 0,
  perpCostsQuote: 0,
  netPnlQuote: 0,
  netReturnPct: 0,
  capitalRequiredQuote: 0,
  maxDrawdownQuote: 0,
  worstPeriodQuote: 0,
  liquidated: false,
  liquidationIndex: null,
  liquidationDay: null,
  equityAtLiquidationQuote: null,
  liquidationBufferQuote: 0,
  days: 0,
  limitations: [...LIMITATIONS],
});

export function simulateFundingCarry(input: FundingCarrySimulationInput): FundingCarrySimulation {
  const reasons: string[] = [];

  const numbers: [string, number][] = [
    ["spotNotionalQuote", input.spotNotionalQuote],
    ["perpNotionalQuote", input.perpNotionalQuote],
    ["entryBasisPct", input.entryBasisPct],
    ["exitBasisPct", input.exitBasisPct],
    ["intervalsPerDay", input.intervalsPerDay],
    ["feePctPerLeg", input.feePctPerLeg],
    ["slippagePctPerLeg", input.slippagePctPerLeg],
    ["legsPerSide", input.legsPerSide],
    ["leverage", input.leverage],
    ["maintenanceMarginPct", input.maintenanceMarginPct],
  ];
  for (const [name, value] of numbers) {
    if (!finite(value)) reasons.push(`${name} non è un numero finito.`);
  }
  if (reasons.length > 0) return emptyResult(reasons);

  if (input.spotNotionalQuote <= 0 || input.perpNotionalQuote <= 0) {
    reasons.push("Le due gambe devono avere un nozionale maggiore di zero.");
  }
  if (input.leverage <= 0) reasons.push("leverage deve essere maggiore di zero.");
  if (input.intervalsPerDay <= 0 || !Number.isInteger(input.intervalsPerDay)) {
    reasons.push("intervalsPerDay deve essere un intero maggiore di zero.");
  }
  if (input.legsPerSide <= 0 || !Number.isInteger(input.legsPerSide)) {
    reasons.push("legsPerSide deve essere un intero maggiore di zero.");
  }
  if (input.feePctPerLeg < 0 || input.slippagePctPerLeg < 0) {
    reasons.push("I costi non possono essere negativi.");
  }
  if (input.maintenanceMarginPct < 0 || input.maintenanceMarginPct >= 100) {
    reasons.push("maintenanceMarginPct deve essere compreso tra 0 e 100 (esclusi).");
  }
  if (!Array.isArray(input.fundingRates) || input.fundingRates.length === 0) {
    reasons.push("Serie di funding vuota: una simulazione senza periodi non ha risultato.");
  } else if (!input.fundingRates.every((rate) => finite(rate))) {
    reasons.push("La serie di funding contiene valori non finiti.");
  }
  if (reasons.length > 0) return emptyResult(reasons);

  const capitalRequiredQuote = input.spotNotionalQuote + input.perpNotionalQuote / input.leverage;
  const marginQuote = input.perpNotionalQuote / input.leverage;
  const maintenanceQuote = (input.maintenanceMarginPct / 100) * input.perpNotionalQuote;
  const liquidationBufferQuote = marginQuote - maintenanceQuote;

  // Costs are charged on each leg separately: averaging the two notionals understates
  // the bill whenever the hedge is not perfectly equal.
  const costRate = (input.feePctPerLeg + input.slippagePctPerLeg) / 100;
  const legsPerSideFactor = input.legsPerSide / 2;
  const spotCostsQuote = 2 * legsPerSideFactor * costRate * input.spotNotionalQuote;
  const perpCostsQuote = 2 * legsPerSideFactor * costRate * input.perpNotionalQuote;
  const costsQuote = spotCostsQuote + perpCostsQuote;
  // Entry costs are paid at the start; exit costs are charged on top even if the
  // position is liquidated, because a close still has a cost and the real liquidation
  // fee is unknown here (understating it would overstate the result).
  const entryCostsQuote = costsQuote / 2;

  // Convergence on the short perpetual: profit when the basis narrows.
  const plannedBasisPnlQuote =
    ((input.entryBasisPct - input.exitBasisPct) / 100) * input.perpNotionalQuote;

  const periods: FundingCarryPeriod[] = [];
  let cumulativeFunding = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let worstPeriod = 0;
  let liquidated = false;
  let liquidationIndex: number | null = null;
  let liquidationDay: number | null = null;
  let equityAtLiquidationQuote: number | null = null;

  for (let index = 0; index < input.fundingRates.length; index += 1) {
    const rate = input.fundingRates[index];
    const fundingPnlQuote = rate * input.perpNotionalQuote;
    cumulativeFunding += fundingPnlQuote;
    // The curve is the strategy P&L, not the margin account: the margin itself is
    // reported separately as capitalRequiredQuote.
    const equity = cumulativeFunding - entryCostsQuote;

    if (index === 0) worstPeriod = equity;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    worstPeriod = Math.min(worstPeriod, equity);

    periods.push({
      index,
      day: (index + 1) / input.intervalsPerDay,
      rate,
      fundingPnlQuote,
      cumulativeFundingQuote: cumulativeFunding,
      equityQuote: equity,
    });

    // Liquidation test on the margin account: margin + strategy P&L against the
    // maintenance requirement the venue keeps.
    const marginAccount = marginQuote + equity;
    if (marginAccount <= maintenanceQuote) {
      liquidated = true;
      liquidationIndex = index;
      liquidationDay = (index + 1) / input.intervalsPerDay;
      equityAtLiquidationQuote = marginAccount;
      reasons.push(
        `Posizione liquidata al periodo ${index} (giorno ${liquidationDay}): il margine non copre più il mantenimento. La simulazione si ferma qui, il basis non viene incassato e il risultato non è valido.`,
      );
      break;
    }
  }

  const basisPnlQuote = liquidated ? 0 : plannedBasisPnlQuote;
  const netPnlQuote = cumulativeFunding + basisPnlQuote - costsQuote;
  const days = periods.length / input.intervalsPerDay;

  return {
    ok: !liquidated && reasons.length === 0,
    reasons,
    periods,
    totalFundingQuote: cumulativeFunding,
    basisPnlQuote,
    costsQuote,
    spotCostsQuote,
    perpCostsQuote,
    netPnlQuote,
    netReturnPct: capitalRequiredQuote > 0 ? (netPnlQuote / capitalRequiredQuote) * 100 : 0,
    capitalRequiredQuote,
    maxDrawdownQuote: maxDrawdown,
    worstPeriodQuote: worstPeriod,
    liquidated,
    liquidationIndex,
    liquidationDay,
    equityAtLiquidationQuote,
    liquidationBufferQuote,
    days,
    limitations: [...LIMITATIONS],
  };
}
