import { guardedMutation, jsonError, jsonOk } from "@/lib/api";
import { clientMeta, currentUser } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";
import { all, run } from "@/lib/db";
import { snapshot } from "@/lib/engine/indicators";
import { getHistoricalCandles } from "@/lib/venues/kraken";
import { assertMarketDataDisplayAllowed } from "@/lib/venues/licensing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const INTERVALS = new Set([1, 5, 15, 30, 60, 240, 1440, 10080, 21600]);

type StoredCandle = {
  venue: string;
  pair: string;
  interval_minutes: number;
  open_time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  vwap: number;
  volume: number;
  trades: number;
  fetched_at: string;
};

/** Read the locally cached, operator-only candle history. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return jsonError("Autenticazione richiesta.", 401);
  if (user.role !== "admin") return jsonError("Storico OHLC riservato all'amministratore del progetto.", 403);
  const { ip } = await clientMeta();
  if (!rateLimit(`history:candles:${user.id}:${ip}`, 30, 60_000).ok) {
    return jsonError("Troppe richieste sullo storico OHLC. Attendi qualche secondo.", 429);
  }

  try {
    assertMarketDataDisplayAllowed("kraken", "internal");
  } catch (error) {
    return jsonError((error as Error).message, 451);
  }

  const url = new URL(req.url);
  const pair = (url.searchParams.get("pair") ?? "BTC/USD").toUpperCase();
  const interval = Number(url.searchParams.get("interval") ?? 60);
  if (!/^[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}$/.test(pair) || !INTERVALS.has(interval)) {
    return jsonError("Coppia o intervallo OHLC non valido.");
  }

  const candles = all<StoredCandle>(
    "SELECT * FROM market_candles WHERE venue = 'kraken' AND pair = ? AND interval_minutes = ? ORDER BY open_time DESC LIMIT 720",
    pair,
    interval,
  ).reverse();

  return jsonOk({
    venue: "kraken",
    pair,
    intervalMinutes: interval,
    scope: "operator-internal-only",
    count: candles.length,
    indicators: snapshot(candles.map((candle) => candle.close)),
    candles,
  }, { headers: { "Cache-Control": "no-store" } });
}

/** Fetch and persist closed candles. No client-facing market-data redistribution. */
export async function POST(req: Request) {
  const { user, error } = await guardedMutation(req, { limit: 5, windowMs: 60_000, adminOnly: true });
  if (error || !user) return error ?? jsonError("Autenticazione richiesta.", 401);

  try {
    assertMarketDataDisplayAllowed("kraken", "internal");
  } catch (err) {
    return jsonError((err as Error).message, 451);
  }

  let body: { pair?: unknown; intervalMinutes?: unknown; since?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("Corpo JSON non valido.");
  }

  const pair = typeof body.pair === "string" ? body.pair.toUpperCase() : "BTC/USD";
  const intervalMinutes = typeof body.intervalMinutes === "number" ? body.intervalMinutes : 60;
  const since = body.since === undefined ? Math.floor(Date.now() / 1000) - 30 * 86400 : body.since;
  if (!/^[A-Z0-9]{2,12}\/[A-Z0-9]{2,12}$/.test(pair) || !INTERVALS.has(intervalMinutes)) {
    return jsonError("Coppia o intervallo OHLC non valido.");
  }
  if (typeof since !== "number" || !Number.isSafeInteger(since) || since < 0 || since > Math.floor(Date.now() / 1000)) {
    return jsonError("since deve essere un timestamp Unix in secondi valido e non futuro.");
  }

  try {
    const result = await getHistoricalCandles({ pair, intervalMinutes, since });
    const fetchedAt = new Date().toISOString();
    for (const candle of result.candles) {
      run(
        `INSERT INTO market_candles(
          venue, pair, interval_minutes, open_time, open, high, low, close, vwap, volume, trades, fetched_at
        ) VALUES('kraken',?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(venue, pair, interval_minutes, open_time) DO UPDATE SET
          open=excluded.open, high=excluded.high, low=excluded.low, close=excluded.close,
          vwap=excluded.vwap, volume=excluded.volume, trades=excluded.trades, fetched_at=excluded.fetched_at`,
        pair,
        intervalMinutes,
        candle.openTime,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.vwap,
        candle.volume,
        candle.trades,
        fetchedAt,
      );
    }

    const { ip } = await clientMeta();
    // Audit only the ingestion metadata; no API keys or account secrets are involved.
    const { audit } = await import("@/lib/audit");
    audit(user.id, "history.candles.ingest", `${pair}/${intervalMinutes}`, {
      provider: "kraken",
      count: result.candles.length,
      since,
      last: result.last,
    }, ip);

    return jsonOk({
      venue: "kraken",
      pair,
      intervalMinutes,
      scope: "operator-internal-only",
      stored: result.candles.length,
      last: result.last,
      indicators: snapshot(result.candles.map((candle) => candle.close)),
      candles: result.candles,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(`Storico OHLC non disponibile: ${(err as Error).message}`, 502);
  }
}
