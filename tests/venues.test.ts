import { after, test } from "node:test";
import assert from "node:assert/strict";
import { bybit } from "../src/lib/venues/bybit";
import { coinbase } from "../src/lib/venues/coinbase";
import { kraken } from "../src/lib/venues/kraken";

/**
 * Adapter contract tests.
 *
 * The HTTP layer is replaced with a fetch stub, so these tests pin how each
 * adapter parses and validates the *real* response shape while never touching
 * the network. Order matters: the adapters cache their instrument/pair index for
 * the process lifetime, so the discovery fixtures are served first.
 */

const originalFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = originalFetch;
});

type MockResult = { status?: number; body: unknown };
const calls: string[] = [];

function installFetch(handler: (url: string) => MockResult) {
  calls.length = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const { status = 200, body } = handler(url);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

const lastCall = () => calls[calls.length - 1] ?? "";

/* -------------------------------------------------------------------------- */
/* Kraken                                                                     */
/* -------------------------------------------------------------------------- */

const KRAKEN_PAIRS = {
  error: [],
  result: {
    XXBTZUSD: { altname: "XBTUSD", wsname: "BTC/USD", base: "XXBT", quote: "ZUSD", status: "online" },
    XETHZUSD: { altname: "ETHUSD", wsname: "ETH/USD", base: "XETH", quote: "ZUSD", status: "online" },
    XXBTZGBP: { altname: "XBTGBP", wsname: "BTC/GBP", base: "XXBT", quote: "ZGBP", status: "online" },
    XDOGEZUSD: { altname: "XDGUSD", wsname: "DOGE/USD", base: "XXDG", quote: "ZUSD", status: "online" },
    XXRPZUSD: { altname: "XRPUSD", wsname: "XRP/USD", base: "XXRP", quote: "ZUSD", status: "delisted" },
  },
};

test("kraken: discovery normalises XBT and keeps only monitored base/quote pairs", async () => {
  installFetch(() => ({ body: KRAKEN_PAIRS }));

  assert.deepEqual((await kraken.discoverPairs()).sort(), ["BTC/USD", "ETH/USD"]);
  assert.match(lastCall(), /\/0\/public\/AssetPairs$/);
});

test("kraken: tickers parse bid/ask/last and map Kraken result keys to normalised pairs", async () => {
  installFetch(() => ({
    body: {
      error: [],
      result: { XXBTZUSD: { a: ["90001.5", "1", "1"], b: ["89998.5", "2", "2"], c: ["90000", "0.5", "0.5"] } },
    },
  }));

  const tickers = await kraken.tickers(["BTC/USD", "SOL/USD"]);
  assert.equal(tickers.size, 1);

  const btc = tickers.get("BTC/USD");
  assert.ok(btc);
  assert.equal(btc.venue, "kraken");
  assert.deepEqual({ bid: btc.bid, ask: btc.ask, last: btc.last }, { bid: 89998.5, ask: 90001.5, last: 90000 });
  assert.ok(btc.ts > 0);
  // SOL/USD is not in the AssetPairs fixture, so it must never reach the request.
  assert.match(lastCall(), /Ticker\?pair=XBTUSD$/);
});

test("kraken: book sorts both sides and drops non-positive levels", async () => {
  installFetch(() => ({
    body: {
      error: [],
      result: {
        XXBTZUSD: {
          asks: [["100", "1", 0], ["99.5", "2", 0], ["0", "5", 0], ["101", "0", 0]],
          bids: [["98", "1", 0], ["98.5", "3", 0]],
        },
      },
    },
  }));

  const b = await kraken.book("BTC/USD", 3);
  assert.equal(b.venue, "kraken");
  assert.equal(b.pair, "BTC/USD");
  assert.deepEqual(b.asks.map((l) => l.price), [99.5, 100]);
  assert.deepEqual(b.bids.map((l) => l.price), [98.5, 98]);
  assert.match(lastCall(), /Depth\?pair=XBTUSD&count=3$/);
});

test("kraken: an unknown pair fails fast without touching the network", async () => {
  installFetch(() => ({ status: 500, body: {} }));

  await assert.rejects(() => kraken.book("SOL/USD"), /non disponibile/);
  assert.deepEqual(calls, []);
});

test("kraken: a non-empty error array is surfaced instead of parsed as data", async () => {
  installFetch(() => ({ body: { error: ["EQuery:Unknown asset pair"], result: {} } }));

  await assert.rejects(() => kraken.book("BTC/USD"), /EQuery:Unknown asset pair/);
});

test("kraken: HTTP failures are reported with the status code", async () => {
  installFetch(() => ({ status: 500, body: {} }));

  await assert.rejects(() => kraken.book("BTC/USD"), /Kraken HTTP 500/);
});

/* -------------------------------------------------------------------------- */
/* Coinbase                                                                   */
/* -------------------------------------------------------------------------- */

const COINBASE_PRODUCTS = [
  { id: "BTC-USD", base_currency: "BTC", quote_currency: "USD", status: "online" },
  { id: "ETH-EUR", base_currency: "ETH", quote_currency: "EUR", status: "online" },
  { id: "DOGE-USD", base_currency: "DOGE", quote_currency: "USD", status: "online" },
  { id: "SOL-USD", base_currency: "SOL", quote_currency: "USD", status: "online", trading_disabled: true },
  { id: "XRP-USD", base_currency: "XRP", quote_currency: "USD", status: "offline" },
];

test("coinbase: discovery keeps online, enabled products on monitored assets", async () => {
  installFetch(() => ({ body: COINBASE_PRODUCTS }));

  assert.deepEqual(await coinbase.discoverPairs(), ["BTC/USD", "ETH/EUR"]);
  assert.match(lastCall(), /\/products$/);
});

test("coinbase: tickers read bid/ask/price from the product ticker endpoint", async () => {
  installFetch(() => ({ body: { bid: "90000.5", ask: "90001", price: "90000.7" } }));

  const tickers = await coinbase.tickers(["BTC/USD", "SOL/USD"]);
  assert.equal(tickers.size, 1);

  const btc = tickers.get("BTC/USD");
  assert.ok(btc);
  assert.equal(btc.venue, "coinbase");
  assert.deepEqual({ bid: btc.bid, ask: btc.ask, last: btc.last }, { bid: 90000.5, ask: 90001, last: 90000.7 });
  assert.match(lastCall(), /\/products\/BTC-USD\/ticker$/);
});

test("coinbase: book is sorted and trimmed to the requested depth", async () => {
  installFetch(() => ({
    body: { asks: [["101", "1"], ["100.5", "2"]], bids: [["99", "1"], ["99.5", "2"]] },
  }));

  const b = await coinbase.book("BTC/USD", 1);
  assert.equal(b.asks.length, 1);
  assert.equal(b.asks[0].price, 100.5);
  assert.equal(b.asks[0].size, 2);
  assert.equal(b.bids[0].price, 99.5);
  assert.match(lastCall(), /\/products\/BTC-USD\/book\?level=2$/);
});

test("coinbase: a failing ticker is skipped, a failing book is an error", async () => {
  installFetch(() => ({ status: 500, body: {} }));

  assert.equal((await coinbase.tickers(["BTC/USD"])).size, 0);
  await assert.rejects(() => coinbase.book("BTC/USD"), /Coinbase HTTP 500/);
});

/* -------------------------------------------------------------------------- */
/* Bybit                                                                      */
/* -------------------------------------------------------------------------- */

const BYBIT_INSTRUMENTS = {
  retCode: 0,
  retMsg: "OK",
  result: {
    list: [
      { symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT", status: "Trading" },
      { symbol: "ETHUSDT", baseCoin: "ETH", quoteCoin: "USDT", status: "PreLaunch" },
      { symbol: "DOGEUSDT", baseCoin: "DOGE", quoteCoin: "USDT", status: "Trading" },
    ],
  },
};

test("bybit: discovery ignores non-trading instruments and unmonitored assets", async () => {
  installFetch(() => ({ body: BYBIT_INSTRUMENTS }));

  assert.deepEqual(await bybit.discoverPairs(), ["BTC/USDT"]);
  assert.match(lastCall(), /\/v5\/market\/instruments-info\?category=spot$/);
});

test("bybit: tickers use the spot category and ignore symbols we do not track", async () => {
  installFetch(() => ({
    body: {
      retCode: 0,
      retMsg: "OK",
      result: {
        list: [
          { symbol: "BTCUSDT", bid1Price: "90000", ask1Price: "90001", lastPrice: "90000.5" },
          { symbol: "ETHUSDT", bid1Price: "3000", ask1Price: "3001", lastPrice: "3000.5" },
        ],
      },
    },
  }));

  const tickers = await bybit.tickers(["BTC/USDT", "ETH/USDT"]);
  assert.equal(tickers.size, 1);

  const btc = tickers.get("BTC/USDT");
  assert.ok(btc);
  assert.equal(btc.venue, "bybit");
  assert.deepEqual({ bid: btc.bid, ask: btc.ask, last: btc.last }, { bid: 90000, ask: 90001, last: 90000.5 });
  assert.match(lastCall(), /tickers\?category=spot$/);
});

test("bybit: order book clamps the depth limit and stamps local receive time", async () => {
  installFetch(() => ({
    body: {
      retCode: 0,
      retMsg: "OK",
      result: { s: "BTCUSDT", b: [["89999", "1"], ["89998", "2"]], a: [["90001", "1"], ["90002", "2"]], ts: Date.now() },
    },
  }));

  const b = await bybit.book("BTC/USDT", 500);
  assert.equal(b.venue, "bybit");
  assert.equal(b.asks.length, 2);
  assert.deepEqual(b.bids.map((l) => l.price), [89999, 89998]);
  assert.match(lastCall(), /limit=50$/);
  assert.ok(Math.abs(b.ts - Date.now()) < 2000, "book.ts must be the local receive time");
});

test("bybit: stale or missing exchange timestamps invalidate the snapshot", async () => {
  installFetch(() => ({
    body: {
      retCode: 0,
      retMsg: "OK",
      result: { s: "BTCUSDT", b: [["1", "1"]], a: [["2", "1"]], ts: Date.now() - 60_000 },
    },
  }));
  await assert.rejects(() => bybit.book("BTC/USDT"), /troppo vecchio|timestamp anomalo/);

  installFetch(() => ({ body: { retCode: 0, retMsg: "OK", result: { s: "BTCUSDT", b: [["1", "1"]], a: [["2", "1"]] } } }));
  await assert.rejects(() => bybit.book("BTC/USDT"), /timestamp del book mancante/);
});

test("bybit: a non-zero retCode is an error, never empty data", async () => {
  installFetch(() => ({ body: { retCode: 10001, retMsg: "params error", result: {} } }));

  await assert.rejects(() => bybit.book("BTC/USDT"), /Bybit API 10001: params error/);
});
