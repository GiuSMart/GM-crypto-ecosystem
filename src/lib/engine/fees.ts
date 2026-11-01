import { REFERENCE_FEES, VENUE_MAP, type ExchangeFee } from "../config";
import { getFeeOverride } from "../db";

export type ResolvedFee = {
  venueId: string;
  makerPct: number;
  takerPct: number;
  source: string;
  confidence: "verified" | "unverified" | "user";
  note: string | null;
};

/** Only account-confirmed or operator-verified fee schedules may drive executable signals. */
export function feeCanDriveSignal(confidence: ResolvedFee["confidence"]): boolean {
  return confidence !== "unverified";
}

/**
 * Fee actually used for a signal:
 *   user override  >  operator reference schedule.
 * The engine always charges the TAKER fee, because an arbitrage leg crosses the
 * spread and therefore takes liquidity.
 */
export function resolveFee(venueId: string, userId: string | null): ResolvedFee | null {
  const reference: ExchangeFee | null = REFERENCE_FEES[venueId] ?? null;
  const override = getFeeOverride(venueId, userId);
  if (override) {
    return {
      venueId,
      makerPct: override.maker_pct,
      takerPct: override.taker_pct,
      source: `override utente del ${override.updated_at.slice(0, 10)}`,
      confidence: "user",
      note: override.note,
    };
  }
  if (!reference || !feeCanDriveSignal(reference.confidence)) return null;
  return {
    venueId,
    makerPct: reference.makerPct,
    takerPct: reference.takerPct,
    source: reference.source,
    confidence: reference.confidence,
    note: reference.note ?? null,
  };
}

export function venueName(venueId: string): string {
  return VENUE_MAP[venueId]?.name ?? venueId;
}
