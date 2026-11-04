/**
 * Deterministic implementation of the BTC asymmetric spot rules.
 * Calculates allocations, signals and limit-price targets only.
 * Never connects to an exchange or places/cancels orders.
 */
export type BtcStrategyConfig = {
  capitalEur: number;
  cashPct: number;
  cryptoReservePct: number;
  dcaReservePct: number;
  buyZoneMinDropPct: number;
  buyZoneMaxDropPct: number;
  dcaTriggerDropPct: number;
  twapMinutes: number;
  buyFeePct: number;
  sellFeePct: number;
  netTargetsPct: number[];
};

export const DEFAULT_BTC_STRATEGY: Readonly<Omit<BtcStrategyConfig, "capitalEur">> = {
  cashPct: 40,
  cryptoReservePct: 40,
  dcaReservePct: 20,
  buyZoneMinDropPct: 2,
  buyZoneMaxDropPct: 4,
  dcaTriggerDropPct: 8,
  twapMinutes: 120,
  buyFeePct: 0.09,
  sellFeePct: 0.09,
  netTargetsPct: [2, 3, 4, 5, 8],
};

export type BtcDailySignal = "accumulate_twap" | "activate_dca_reserve" | "wait";
export type BtcAllocation = {
  cashEur: number;
  cryptoInventoryTargetEur: number;
  dcaReserveEur: number;
  totalEur: number;
};
export type TakeProfitTarget = {
  targetNetPct: number;
  multiplier: number;
  sellPriceEur: number;
  netProfitEur: number;
};

export function validateBtcStrategyConfig(config: BtcStrategyConfig): string[] {
  const errors: string[] = [];
  const percentages = [config.cashPct, config.cryptoReservePct, config.dcaReservePct];
  if (percentages.some((value) => !Number.isFinite(value) || value < 0 || value > 100)) {
    errors.push("Le percentuali di allocazione devono essere comprese tra 0 e 100.");
  }
  if (Math.abs(percentages.reduce((sum, value) => sum + value, 0) - 100) > 1e-9) {
    errors.push("Le tre allocazioni devono totalizzare il 100% del capitale.");
  }
  if (!Number.isFinite(config.capitalEur) || config.capitalEur <= 0) {
    errors.push("Il capitale deve essere un importo positivo.");
  }
  if (!(config.buyFeePct >= 0) || !(config.sellFeePct >= 0) || config.buyFeePct >= 100 || config.sellFeePct >= 100) {
    errors.push("Le commissioni devono essere percentuali valide inferiori al 100%.");
  }
  if (!(config.buyZoneMinDropPct > 0) || config.buyZoneMaxDropPct < config.buyZoneMinDropPct) {
    errors.push("La fascia di accumulo deve avere limiti positivi e coerenti.");
  }
  if (!(config.dcaTriggerDropPct > config.buyZoneMaxDropPct)) {
    errors.push("Il trigger della riserva DCA deve essere oltre la fascia di accumulo.");
  }
  if (!Number.isInteger(config.twapMinutes) || config.twapMinutes < 1) {
    errors.push("La durata TWAP deve essere un numero intero positivo di minuti.");
  }
  if (!config.netTargetsPct.length || config.netTargetsPct.some((value) => !Number.isFinite(value) || value <= 0)) {
    errors.push("I target netti devono contenere percentuali positive.");
  }
  return errors;
}

/** The BTC inventory target is a value of existing crypto, not spendable cash. */
export function allocateBtcBudget(capitalEur: number, config = DEFAULT_BTC_STRATEGY): BtcAllocation {
  if (!Number.isFinite(capitalEur) || capitalEur <= 0) throw new Error("Il capitale deve essere positivo.");
  const totalPct = config.cashPct + config.cryptoReservePct + config.dcaReservePct;
  if (Math.abs(totalPct - 100) > 1e-9) throw new Error("Le allocazioni devono totalizzare il 100%.");
  return {
    cashEur: Number((capitalEur * config.cashPct / 100).toFixed(2)),
    cryptoInventoryTargetEur: Number((capitalEur * config.cryptoReservePct / 100).toFixed(2)),
    dcaReserveEur: Number((capitalEur * config.dcaReservePct / 100).toFixed(2)),
    totalEur: Number(capitalEur.toFixed(2)),
  };
}

/** Daily change is a signed percentage versus the daily open. */
export function classifyBtcDailyMove(
  dailyChangePct: number,
  config = DEFAULT_BTC_STRATEGY,
): BtcDailySignal {
  if (!Number.isFinite(dailyChangePct)) throw new Error("Variazione giornaliera non valida.");
  if (dailyChangePct <= -config.dcaTriggerDropPct) return "activate_dca_reserve";
  if (dailyChangePct <= -config.buyZoneMinDropPct && dailyChangePct >= -config.buyZoneMaxDropPct) {
    return "accumulate_twap";
  }
  return "wait";
}

/**
 * Exact sell price for a requested net return on entry capital:
 * entry * (1 + buy fee) * (1 + target net) / (1 - sell fee).
 */
export function calculateBtcTakeProfit(
  averageEntryPriceEur: number,
  targetNetPct: number,
  buyFeePct = DEFAULT_BTC_STRATEGY.buyFeePct,
  sellFeePct = DEFAULT_BTC_STRATEGY.sellFeePct,
  positionCostEur = 10_000,
): TakeProfitTarget {
  if (!(averageEntryPriceEur > 0) || !Number.isFinite(averageEntryPriceEur)) {
    throw new Error("Prezzo medio di carico non valido.");
  }
  if (!(targetNetPct > 0) || !Number.isFinite(targetNetPct)) {
    throw new Error("Il target netto deve essere positivo.");
  }
  if (!(buyFeePct >= 0 && buyFeePct < 100) || !(sellFeePct >= 0 && sellFeePct < 100)) {
    throw new Error("Commissioni non valide.");
  }
  if (!(positionCostEur > 0) || !Number.isFinite(positionCostEur)) {
    throw new Error("Il controvalore della posizione deve essere positivo.");
  }
  const buyFee = buyFeePct / 100;
  const sellFee = sellFeePct / 100;
  const target = targetNetPct / 100;
  const multiplier = ((1 + buyFee) * (1 + target)) / (1 - sellFee);
  return {
    targetNetPct,
    multiplier: Number(multiplier.toFixed(8)),
    sellPriceEur: Number((averageEntryPriceEur * multiplier).toFixed(2)),
    netProfitEur: Number((positionCostEur * target).toFixed(2)),
  };
}

export function buildBtcTakeProfitTable(
  averageEntryPriceEur: number,
  positionCostEur: number,
  config = DEFAULT_BTC_STRATEGY,
): TakeProfitTarget[] {
  return config.netTargetsPct.map((target) =>
    calculateBtcTakeProfit(averageEntryPriceEur, target, config.buyFeePct, config.sellFeePct, positionCostEur),
  );
}
