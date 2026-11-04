# Historical candles — internal research scope

## Current implementation

Historical OHLC ingestion uses Kraken's public Spot REST endpoint through the existing
per-venue throttle and fixed HTTPS host. No API key is required.

- Provider: Kraken public `OHLC` endpoint.
- Supported intervals: 1, 5, 15, 30, 60, 240, 1440, 10080 and 21600 minutes.
- Provider limit: Kraken returns at most 720 recent rows per request.
- The currently-forming candle is excluded; only fully closed candles are stored.
- OHLC, VWAP, volume, trade count, pair and interval are validated before persistence.
- Rows are upserted by `(venue, pair, interval_minutes, open_time)`.
- SQLite table: `market_candles`.

## API (administrator only)

Refresh and persist:

```http
POST /api/history/candles
Content-Type: application/json

{
  "pair": "BTC/USD",
  "intervalMinutes": 60,
  "since": 1793577600
}
```

`since` is an optional Unix timestamp in seconds; if omitted, the last 30 days are
requested. Kraken still caps each response at 720 candles.

Read the locally stored series:

```http
GET /api/history/candles?pair=BTC/USD&interval=60
```

Both operations require an authenticated project administrator. Reads and refreshes
are rate-limited and refreshes are written to the audit log. This endpoint is not
available to client tenants.

## Indicators

The response includes the deterministic `snapshot()` calculated from closed candle
closes. Short histories produce `null` indicators rather than fabricated values.
The indicator output is descriptive research data, not a buy/sell instruction.

## Licensing boundary

Kraken's commercial market-data display/redistribution terms have not yet been
cleared in `src/lib/venues/licensing.ts`. The route therefore enforces the
`internal` context and administrator-only access. Do not expose these candles,
indicator outputs, derived charts, exports or API responses to customer tenants,
public pages or third parties until written rights for the intended commercial use
have been reviewed and recorded.

The OKX data prohibition is separate and remains in force. An open-source MIT code
license for an adapter or toolkit never grants rights to exchange data.

## Not yet implemented

- Multi-page historical backfill beyond Kraken's 720-row response limit.
- Automatic scheduled refresh and retention/compaction.
- Coinbase and Bybit OHLC adapters (pending venue-specific licensing review).
- Walk-forward backtesting, fee/slippage replay and no-look-ahead proof.
- Customer-facing charts or export (blocked pending data rights).
