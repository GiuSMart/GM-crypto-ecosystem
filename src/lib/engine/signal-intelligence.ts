export type SignalObservation = {
  ts: string;
  pair: string;
  buy_venue: string;
  sell_venue: string;
  net_profit: number;
  margin_pct: number;
  executable: number;
};

export type SignalPersistence = {
  key: string;
  pair: string;
  buyVenue: string;
  sellVenue: string;
  samples: number;
  executableSamples: number;
  positiveNetSamples: number;
  firstSeen: string;
  lastSeen: string;
  durationMinutes: number;
  averageNetProfit: number;
  averageMarginPct: number;
  bestMarginPct: number;
  status: "In osservazione" | "Ricorrente" | "Persistente";
};

/**
 * Summarize repeated observations of the exact same route.
 * This is descriptive history, not a probability or prediction of future profit.
 */
export function summarizeSignalPersistence(observations: SignalObservation[]): SignalPersistence[] {
  const groups = new Map<string, SignalObservation[]>();

  for (const observation of observations) {
    if (!Number.isFinite(observation.net_profit) || !Number.isFinite(observation.margin_pct)) continue;
    const key = [observation.pair, observation.buy_venue, observation.sell_venue].join("|");
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }

  return [...groups.entries()]
    .map(([key, rows]) => {
      const ordered = [...rows].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      const firstSeen = ordered[0].ts;
      const lastSeen = ordered[ordered.length - 1].ts;
      const firstMs = Date.parse(firstSeen);
      const lastMs = Date.parse(lastSeen);
      const durationMinutes = Number.isFinite(firstMs) && Number.isFinite(lastMs)
        ? Math.max(0, (lastMs - firstMs) / 60_000)
        : 0;
      const samples = rows.length;
      const status = samples >= 3 && durationMinutes >= 5
        ? "Persistente"
        : samples >= 2
          ? "Ricorrente"
          : "In osservazione";

      return {
        key,
        pair: rows[0].pair,
        buyVenue: rows[0].buy_venue,
        sellVenue: rows[0].sell_venue,
        samples,
        executableSamples: rows.filter((row) => row.executable === 1).length,
        positiveNetSamples: rows.filter((row) => row.net_profit > 0).length,
        firstSeen,
        lastSeen,
        durationMinutes,
        averageNetProfit: rows.reduce((sum, row) => sum + row.net_profit, 0) / samples,
        averageMarginPct: rows.reduce((sum, row) => sum + row.margin_pct, 0) / samples,
        bestMarginPct: Math.max(...rows.map((row) => row.margin_pct)),
        status,
      };
    })
    .sort((a, b) =>
      b.samples - a.samples ||
      b.executableSamples - a.executableSamples ||
      b.averageNetProfit - a.averageNetProfit
    )
    .slice(0, 8);
}
