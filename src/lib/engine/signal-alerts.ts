export type AlertCandidate = {
  pair: string;
  buyVenue: string;
  sellVenue: string;
  netProfit: number;
  marginPct: number;
  executable: boolean;
};

export type VerifiedSignalAlert = AlertCandidate & { key: string };

/**
 * Only surface evaluations that the engine itself marked executable and whose
 * net result is finite and strictly positive after configured costs.
 */
export function verifiedSignalAlerts(candidates: AlertCandidate[]): VerifiedSignalAlert[] {
  return candidates
    .filter((candidate) =>
      candidate.executable === true &&
      Number.isFinite(candidate.netProfit) &&
      candidate.netProfit > 0 &&
      Number.isFinite(candidate.marginPct) &&
      candidate.marginPct > 0
    )
    .map((candidate) => ({
      ...candidate,
      key: [candidate.pair, candidate.buyVenue, candidate.sellVenue].join("|"),
    }))
    .sort((a, b) => b.netProfit - a.netProfit)
    .slice(0, 3);
}

/** Per-route cooldown prevents repeated notifications for an unchanged signal. */
export function isAlertCooldownComplete(
  lastNotifiedAt: number | null,
  now: number,
  cooldownMs = 15 * 60 * 1000,
): boolean {
  if (lastNotifiedAt === null || !Number.isFinite(lastNotifiedAt)) return true;
  return now - lastNotifiedAt >= cooldownMs;
}
