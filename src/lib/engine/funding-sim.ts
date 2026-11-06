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
 * - costs: taker fee plus slippage, charged on both legs at entry and at exit.
 *
 * The simulation is a model of a two-leg position, not a guarantee that both legs
 * filled at the modelled prices.
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
  equityQuote: number;
};

export type FundingCarrySimulation = {
  ok: boolean;
  reasons: string[];
  periods: FundingCarryPeriod[];
  totalFundingQuote: number;
  basisPnlQuote: number;
  costsQuote: number;
  netPnlQuote: number;
  /** Net P&L as a percentage of the capital the position requires. */
  netReturnPct: number;
  /** Capital locked by the strategy: spot leg plus the perpetual margin. */
  capitalRequiredQuote: number;
  maxDrawdownQuote: number;
  worstPeriodQuote: number;
  liquidated: boolean;
  /** Risk capital distance: how far the perp leg can move before liquidation. */
  liquidationBufferQuote: number;
  days: number;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const emptyResult = (reasons: string[]): FundingCarrySimulation => ({
  ok: false,
  reasons,
  periods: [],
  totalFundingQuote: 0,
  basisPnlQuote: 0,
  costsQuote: 0,
  netPnlQuote: 0,
  netReturnPct: 0,
  capitalRequiredQuote: 0,
  maxDrawdownQuote: 0,
  worstPeriodQuote: 0,
  liquidated: false,
  liquidationBufferQuote: 0,
  days: 0,
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
  if (input.intervalsPerDay <= 0) reasons.push("intervalsPerDay deve essere maggiore di zero.");
  if (input.legsPerSide <= 0) reasons.push("legsPerSide deve essere maggiore di zero.");
  if (input.feePctPerLeg < 0 || input.slippagePctPerLeg < 0) {
    reasons.push("I costi non possono essere negativi.");
  }
  if (!Array.isArray(input.fundingRates) || input.fundingRates.length === 0) {
    reasons.push("Serie di funding vuota: una simulazione senza periodi non ha risultato.");
  } else if (!input.fundingRates.every((rate) => finite(rate))) {
    reasons.push("La serie di funding contiene valori non finiti.");
  }
  if (reasons.length > 0) return emptyResult(reasons);

  const capitalRequiredQuote = input.spotNotionalQuote + input.perpNotionalQuote / input.leverage;
  const liquidationBufferQuote =
    (1 / input.leverage - input.maintenanceMarginPct / 100) * input.perpNotionalQuote;
  const costsQuote =
    2 *
    input.legsPerSide *
    ((input.feePctPerLeg + input.slippagePctPerLeg) / 100) *
    ((input.spotNotionalQuote + input.perpNotionalQuote) / 2);

  // Convergence on the short perpetual: profit when the basis narrows.
  const basisPnlQuote =
    ((input.entryBasisPct - input.exitBasisPct) / 100) * input.perpNotionalQuote;

  const periods: FundingCarryPeriod[] = [];
  let cumulativeFunding = 0;
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  let worstPeriod = 0;
  let liquidated = false;

  for (let index = 0; index < input.fundingRates.length; index += 1) {
    const rate = input.fundingRates[index];
    const fundingPnlQuote = rate * input.perpNotionalQuote;
    cumulativeFunding += fundingPnlQuote;
    equity = cumulativeFunding - costsQuote;

    if (index === 0) worstPeriod = equity;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    worstPeriod = Math.min(worstPeriod, equity);

    // The short leg is liquidated when its loss exceeds the margin buffer.
    if (-(cumulativeFunding + basisPnlQuote - costsQuote) > liquidationBufferQuote) {
      liquidated = true;
    }

    periods.push({
      index,
      day: (index + 1) / input.intervalsPerDay,
      rate,
      fundingPnlQuote,
      cumulativeFundingQuote: cumulativeFunding,
      equityQuote: equity,
    });
  }

  const netPnlQuote = cumulativeFunding + basisPnlQuote - costsQuote;
  const days = input.fundingRates.length / input.intervalsPerDay;

  return {
    ok: true,
    reasons: [],
    periods,
    totalFundingQuote: cumulativeFunding,
    basisPnlQuote,
    costsQuote,
    netPnlQuote,
    netReturnPct: capitalRequiredQuote > 0 ? (netPnlQuote / capitalRequiredQuote) * 100 : 0,
    capitalRequiredQuote,
    maxDrawdownQuote: maxDrawdown,
    worstPeriodQuote: worstPeriod,
    liquidated,
    liquidationBufferQuote,
    days,
  };
}
