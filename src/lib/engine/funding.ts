/**
 * Funding-rate carry (spot long + perpetual short, delta-neutral) — pure math.
 *
 * The thesis is narrow on purpose: the position is market-neutral, so the return
 * comes from funding payments and basis convergence, not from the price of the
 * asset. That also means the risks are different from cross-exchange arbitrage:
 * funding can flip sign, the basis can widen, the short leg can be liquidated, and
 * one leg can be sized wrong.
 *
 * Design rules, all deliberate:
 * 1. No network, no clock, no randomness, no model. Every input is supplied.
 * 2. Fail closed: unusable prices, stale data or an impossible leverage produce
 *    `ok: false` with reasons, never a generous default.
 * 3. Costs are explicit. A gross funding rate is not a return.
 * 4. The persistence score is a deterministic description of past observations.
 *    It is not a forecast and must never be presented as one.
 */

/** Binance-style 8h funding is the common default, but it is always an input. */
export const DEFAULT_FUNDING_INTERVALS_PER_DAY = 3;

/** Strategy identifier used by the Risk Guard policy. */
export const FUNDING_CARRY_STRATEGY = "funding-carry";

export type FundingObservation = {
  /** Rate per funding interval as a decimal: 0.0001 = 0.01%. */
  rate: number;
  /** Settlement timestamp, epoch milliseconds. */
  at: number;
};

export type FundingHistoryStats = {
  count: number;
  meanRate: number;
  medianRate: number;
  stdevRate: number;
  /** Share of observations with a strictly positive rate, 0..1. */
  positiveShare: number;
  /** Sign changes between consecutive observations. */
  signFlips: number;
  worstRate: number;
  /**
   * Deterministic descriptive score, 0..100: half weight on how often funding was
   * positive, 30% on how large the mean is relative to its dispersion, 20% on how
   * rarely the sign flipped. Descriptive only — no forecasting claim.
   */
  persistenceScore: number;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * Annualised funding rate in percent.
 * `null` when any input is unusable: annualising a NaN would hide a bad feed.
 */
export function annualiseFundingRate(
  ratePerInterval: number,
  intervalsPerDay: number = DEFAULT_FUNDING_INTERVALS_PER_DAY,
): number | null {
  if (!finite(ratePerInterval) || !finite(intervalsPerDay) || intervalsPerDay <= 0) return null;
  return ratePerInterval * intervalsPerDay * 365 * 100;
}

/** Basis in percent: positive when the perpetual trades above spot. */
export function basisPct(spotPrice: number, markPrice: number): number | null {
  if (!finite(spotPrice) || !finite(markPrice) || spotPrice <= 0) return null;
  return ((markPrice - spotPrice) / spotPrice) * 100;
}

export type FundingHistoryValidation =
  | { ok: true; stats: FundingHistoryStats }
  | { ok: false; reasons: string[] };

/**
 * Validate a funding history before computing anything.
 *
 * A malformed observation is a broken feed, not a missing data point: dropping it and
 * describing the remainder would make a corrupted series look stable. Any invalid
 * entry therefore rejects the whole history, and duplicates are refused because two
 * settlements cannot share a timestamp.
 */
export function validateFundingHistory(observations: FundingObservation[]): FundingHistoryValidation {
  if (!Array.isArray(observations)) {
    return { ok: false, reasons: ["La serie di funding deve essere un array di osservazioni."] };
  }
  if (observations.length === 0) {
    return { ok: false, reasons: ["Serie di funding vuota: una storia assente non è una storia stabile."] };
  }

  const reasons: string[] = [];
  const seen = new Set<number>();
  observations.forEach((observation, index) => {
    if (observation === null || typeof observation !== "object" || Array.isArray(observation)) {
      reasons.push(`Osservazione ${index} non è un oggetto.`);
      return;
    }
    if (!finite(observation.rate)) {
      reasons.push(`Osservazione ${index}: rate non finito.`);
    }
    if (!finite(observation.at) || !Number.isInteger(observation.at) || observation.at <= 0) {
      reasons.push(`Osservazione ${index}: timestamp di settlement non valido.`);
    } else if (seen.has(observation.at)) {
      reasons.push(`Osservazione ${index}: timestamp di settlement duplicato (${observation.at}).`);
    } else {
      seen.add(observation.at);
    }
  });

  if (reasons.length > 0) return { ok: false, reasons };

  return { ok: true, stats: computeFundingHistoryStats(observations) };
}

/** `null` for an empty or unusable history: it is never silently reduced to a subset. */
export function fundingHistoryStats(observations: FundingObservation[]): FundingHistoryStats | null {
  const validation = validateFundingHistory(observations);
  return validation.ok ? validation.stats : null;
}

function computeFundingHistoryStats(observations: FundingObservation[]): FundingHistoryStats {
  const rates = observations
    .map((observation) => observation.rate)
    .sort((a, b) => a - b);

  const count = rates.length;
  const meanRate = rates.reduce((sum, rate) => sum + rate, 0) / count;
  const medianRate = count % 2 === 1
    ? rates[(count - 1) / 2]
    : (rates[count / 2 - 1] + rates[count / 2]) / 2;
  const variance = rates.reduce((sum, rate) => sum + (rate - meanRate) ** 2, 0) / count;
  const stdevRate = Math.sqrt(variance);
  const positiveShare = rates.filter((rate) => rate > 0).length / count;

  const ordered = [...observations].sort((a, b) => a.at - b.at);
  let signFlips = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = Math.sign(ordered[index - 1].rate);
    const current = Math.sign(ordered[index].rate);
    if (previous !== 0 && current !== 0 && previous !== current) signFlips += 1;
  }

  const stability = stdevRate > 0 ? Math.min(Math.abs(meanRate) / stdevRate, 3) / 3 : 1;
  const flipPenalty = ordered.length > 1 ? 1 - Math.min(signFlips / (ordered.length - 1), 1) : 1;
  const persistenceScore = Math.round(100 * (0.5 * positiveShare + 0.3 * stability + 0.2 * flipPenalty));

  return {
    count,
    meanRate,
    medianRate,
    stdevRate,
    positiveShare,
    signFlips,
    worstRate: rates[0],
    persistenceScore,
  };
}

export type FundingOpportunityInput = {
  venueId: string;
  instrumentId: string;
  /** Spot leg, already normalized to a price in quote currency. */
  spot: { price: number; dataAgeMs: number };
  /** Perpetual leg. `fundingRate` is the rate that will be applied next. */
  perpetual: {
    markPrice: number;
    indexPrice: number;
    fundingRate: number;
    nextFundingAt: number;
    dataAgeMs: number;
  };
  /** Explicit reference time, epoch milliseconds: settlement times are checked against it. */
  nowMs: number;
  /** Horizon the net result is computed over, then annualised from. */
  holdingDays: number;
  intervalsPerDay: number;
  /** Taker fee per leg per side, percent of notional. */
  feePctPerLeg: number;
  /** Depth-weighted slippage per leg per side, percent of notional. */
  slippagePctPerLeg: number;
  /** Legs opened and later closed on each side (spot + perp = 2). */
  legsPerSide: number;
  maxDataAgeMs: number;
  leverage: number;
  maintenanceMarginPct: number;
  minLiquidationBufferPct: number;
  allowNegativeFunding: boolean;
};

export type FundingOpportunity = {
  ok: boolean;
  reasons: string[];
  /** Funding collected over the horizon, percent of the perpetual notional. */
  grossFundingPct: number;
  /** Entry plus exit costs over the horizon, percent. */
  costPct: number;
  /** Gross funding minus costs, percent over the horizon. */
  netPct: number;
  netAprPct: number;
  basisPct: number;
  /** Days of funding needed to pay back the round-trip cost. */
  breakevenDays: number;
  liquidationBufferPct: number;
  direction: "short-perp-receives" | "long-perp-pays";
};

/**
 * Evaluate one spot/perp carry. `ok` is true only when the data is usable, the
 * position can survive the fallback to liquidation, the funding direction is
 * acceptable and the net result after costs is positive.
 */
export function evaluateFundingOpportunity(input: FundingOpportunityInput): FundingOpportunity {
  const reasons: string[] = [];
  const { spot, perpetual } = input;

  const numbers: [string, number][] = [
    ["spot.price", spot.price],
    ["spot.dataAgeMs", spot.dataAgeMs],
    ["perpetual.markPrice", perpetual.markPrice],
    ["perpetual.indexPrice", perpetual.indexPrice],
    ["nowMs", input.nowMs],
    ["perpetual.fundingRate", perpetual.fundingRate],
    ["perpetual.nextFundingAt", perpetual.nextFundingAt],
    ["perpetual.dataAgeMs", perpetual.dataAgeMs],
    ["holdingDays", input.holdingDays],
    ["intervalsPerDay", input.intervalsPerDay],
    ["feePctPerLeg", input.feePctPerLeg],
    ["slippagePctPerLeg", input.slippagePctPerLeg],
    ["legsPerSide", input.legsPerSide],
    ["maxDataAgeMs", input.maxDataAgeMs],
    ["leverage", input.leverage],
    ["maintenanceMarginPct", input.maintenanceMarginPct],
    ["minLiquidationBufferPct", input.minLiquidationBufferPct],
  ];
  for (const [name, value] of numbers) {
    if (!finite(value)) reasons.push(`${name} non è un numero finito.`);
  }
  if (reasons.length > 0) {
    return {
      ok: false,
      reasons,
      grossFundingPct: 0,
      costPct: 0,
      netPct: 0,
      netAprPct: 0,
      basisPct: 0,
      breakevenDays: Number.POSITIVE_INFINITY,
      liquidationBufferPct: 0,
      direction: "short-perp-receives",
    };
  }

  if (typeof input.venueId !== "string" || input.venueId.trim() === "") {
    reasons.push("venueId mancante: un'opportunità senza venue non è attribuibile né verificabile.");
  }
  if (typeof input.instrumentId !== "string" || input.instrumentId.trim() === "") {
    reasons.push("instrumentId mancante: lo strumento deve essere identificato esplicitamente.");
  }
  if (typeof input.allowNegativeFunding !== "boolean") {
    reasons.push("allowNegativeFunding deve essere esplicito (true/false).");
  }
  if (spot.price <= 0) reasons.push("spot.price deve essere maggiore di zero.");
  if (perpetual.markPrice <= 0) reasons.push("perpetual.markPrice deve essere maggiore di zero.");
  if (perpetual.indexPrice <= 0) {
    reasons.push("perpetual.indexPrice deve essere maggiore di zero: senza indice il basis non è verificabile.");
  }
  if (input.holdingDays <= 0) reasons.push("holdingDays deve essere maggiore di zero.");
  if (input.intervalsPerDay <= 0 || !Number.isInteger(input.intervalsPerDay)) {
    reasons.push("intervalsPerDay deve essere un intero maggiore di zero.");
  }
  if (input.legsPerSide <= 0 || !Number.isInteger(input.legsPerSide)) {
    reasons.push("legsPerSide deve essere un intero maggiore di zero.");
  }
  if (input.leverage <= 0) reasons.push("leverage deve essere maggiore di zero.");
  if (input.maxDataAgeMs <= 0) reasons.push("maxDataAgeMs deve essere maggiore di zero.");
  if (input.feePctPerLeg < 0 || input.slippagePctPerLeg < 0) {
    reasons.push("I costi per gamba non possono essere negativi.");
  }
  if (spot.dataAgeMs < 0 || perpetual.dataAgeMs < 0) {
    reasons.push("L'età dei dati non può essere negativa: book non affidabile.");
  }
  if (spot.dataAgeMs > input.maxDataAgeMs || perpetual.dataAgeMs > input.maxDataAgeMs) {
    reasons.push(
      `Dati obsoleti (spot ${spot.dataAgeMs}ms, perp ${perpetual.dataAgeMs}ms) oltre il massimo ${input.maxDataAgeMs}ms.`,
    );
  }
  if (perpetual.nextFundingAt <= 0) {
    reasons.push("perpetual.nextFundingAt mancante: senza orario di settlement il carry non è pianificabile.");
  } else if (input.nowMs > 0 && perpetual.nextFundingAt < input.nowMs) {
    reasons.push(
      `perpetual.nextFundingAt (${perpetual.nextFundingAt}) precede nowMs (${input.nowMs}): un settlement nel passato non è il prossimo pagamento.`,
    );
  } else if (perpetual.nextFundingAt > input.nowMs + 48 * 3600 * 1000) {
    reasons.push("perpetual.nextFundingAt oltre 48 ore da nowMs: timestamp non plausibile per il prossimo settlement.");
  }
  if (!input.allowNegativeFunding && perpetual.fundingRate < 0) {
    reasons.push(
      `Funding negativo (${perpetual.fundingRate}): la gamba short paga invece di incassare, il carry non ha rendimento atteso.`,
    );
  }
  if (input.maintenanceMarginPct < 0 || input.maintenanceMarginPct >= 100) {
    reasons.push("maintenanceMarginPct deve essere compreso tra 0 e 100 (esclusi).");
  }

  const grossFundingPct =
    perpetual.fundingRate * 100 * input.intervalsPerDay * input.holdingDays;
  const costPct = 2 * input.legsPerSide * (input.feePctPerLeg + input.slippagePctPerLeg);
  const netPct = grossFundingPct - costPct;
  const netAprPct = netPct * (365 / input.holdingDays);

  // Leverage gives an approximate distance to liquidation: the margin buffer is
  // 1/leverage, minus the maintenance margin the venue keeps.
  const liquidationBufferPct = (1 / input.leverage) * 100 - input.maintenanceMarginPct;
  if (liquidationBufferPct < input.minLiquidationBufferPct) {
    reasons.push(
      `Buffer di liquidazione ${liquidationBufferPct.toFixed(2)}% sotto il minimo ${input.minLiquidationBufferPct}%: leva troppo alta per un carry delta-neutral.`,
    );
  }

  const fundingPerDayPct = perpetual.fundingRate * 100 * input.intervalsPerDay;
  const breakevenDays = fundingPerDayPct > 0 ? costPct / fundingPerDayPct : Number.POSITIVE_INFINITY;
  if (netPct <= 0) {
    reasons.push(
      `Rendimento netto ${netPct.toFixed(4)}% non positivo su ${input.holdingDays} giorni: i costi di andata e ritorno non sono coperti dal funding.`,
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    grossFundingPct,
    costPct,
    netPct,
    netAprPct,
    basisPct: ((perpetual.markPrice - spot.price) / spot.price) * 100,
    breakevenDays,
    liquidationBufferPct,
    direction: perpetual.fundingRate >= 0 ? "short-perp-receives" : "long-perp-pays",
  };
}
