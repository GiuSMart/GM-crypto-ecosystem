import test, { after } from "node:test";
import assert from "node:assert/strict";
import { getHistoricalCandles } from "../src/lib/venues/kraken";

const realFetch = globalThis.fetch;
let malformed = false;
const calls: { url: URL; redirect: RequestRedirect | undefined; authorization: boolean }[] = [];

after(() => {
  globalThis.fetch = realFetch;
});

function stubKraken() {
  calls.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    calls.push({
      url,
      redirect: init?.redirect,
      authorization: new Headers(init?.headers).has("Authorization"),
    });
    assert.equal(url.origin, "https://api.kraken.com");

    if (url.pathname.endsWith("/AssetPairs")) {
      return Response.json({
        error: [],
        result: {
          XXBTZUSD: {
            altname: "XBTUSD",
            wsname: "XBT/USD",
            base: "XXBT",
            quote: "ZUSD",
            status: "online",
          },
        },
      });
    }

    if (url.pathname.endsWith("/OHLC")) {
      const rows = malformed
        ? [[1000, "10", "9", "11", "11", "10.5", "5", 10]]
        : [
            [1000, "10", "12", "9", "11", "10.5", "5", 10],
            [1900, "11", "13", "10", "12", "11.5", "4", 8],
            [1980, "12", "14", "11", "13", "12.5", "3", 5],
          ];
      return Response.json({ error: [], result: { XXBTZUSD: rows, last: 2000 } });
    }

    throw new Error("Unexpected Kraken endpoint: " + url.pathname);
  }) as typeof fetch;
}

test("Kraken OHLC normalises the pair and excludes the currently-forming candle", async () => {
  malformed = false;
  stubKraken();

  const result = await getHistoricalCandles({
    pair: "BTC/USD",
    intervalMinutes: 1,
    since: 900,
    nowMs: 2000 * 1000,
  });

  assert.equal(result.last, 2000);
  assert.equal(result.candles.length, 2);
  assert.deepEqual(result.candles.map((candle) => candle.openTime), [1000, 1900]);
  assert.equal(result.candles[0]?.open, 10);
  assert.equal(result.candles[0]?.high, 12);
  assert.equal(result.candles[0]?.low, 9);
  assert.equal(result.candles[0]?.close, 11);
  assert.equal(result.candles[0]?.volume, 5);
  assert.equal(calls.length, 2, "pair discovery and OHLC are the only requests");
  assert.ok(calls.every((call) => call.redirect === "error"));
  assert.ok(calls.every((call) => call.authorization === false));
  const ohlc = calls.find((call) => call.url.pathname.endsWith("/OHLC"))?.url;
  assert.equal(ohlc?.searchParams.get("pair"), "XBTUSD");
  assert.equal(ohlc?.searchParams.get("interval"), "1");
  assert.equal(ohlc?.searchParams.get("since"), "900");
});

test("Kraken OHLC rejects malformed candles and invalid interval parameters", async () => {
  malformed = true;
  stubKraken();
  await assert.rejects(
    () => getHistoricalCandles({ pair: "BTC/USD", intervalMinutes: 1, nowMs: 2000 * 1000 }),
    /candela OHLC con valori non validi/,
  );
  await assert.rejects(
    () => getHistoricalCandles({ pair: "BTC/USD", intervalMinutes: 2 }),
    /Intervallo OHLC Kraken non supportato/,
  );
});

test("Kraken OHLC rejects pairs that are not discovered as supported", async () => {
  malformed = false;
  stubKraken();
  await assert.rejects(
    () => getHistoricalCandles({ pair: "DOGE/USD", intervalMinutes: 5 }),
    /coppia DOGE\/USD non disponibile/,
  );
  assert.equal(calls.length, 0, "an unsupported pair must not make a request");
});
