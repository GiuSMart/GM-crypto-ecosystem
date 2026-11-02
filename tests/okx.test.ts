import assert from "node:assert/strict";
import test from "node:test";
import { okx } from "../src/lib/venues/okx";

test("OKX EEA adapter validates instruments, tickers and order-book responses", async () => {
  const originalFetch = globalThis.fetch;
  const requested: string[] = [];
  let scenario:
    | "normal"
    | "empty-book"
    | "stale-book"
    | "api-error"
    | "http-error"
    | "malformed-data" = "normal";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requested.push(url.toString());

    assert.equal(url.origin, "https://eea.okx.com");
    const headers = new Headers(init?.headers);
    assert.equal(headers.has("Authorization"), false, "public market data must not send credentials");

    if (url.pathname.endsWith("/public/instruments")) {
      return new Response(JSON.stringify({
        code: "0",
        msg: "",
        data: [
          { instId: "BTC-USDT", baseCcy: "BTC", quoteCcy: "USDT", state: "live" },
          { instId: "ETH-USD", baseCcy: "ETH", quoteCcy: "USD", state: "live" },
          { instId: "XRP-USDT", baseCcy: "XRP", quoteCcy: "USDT", state: "suspend" },
          { instId: "DOGE-USDT", baseCcy: "DOGE", quoteCcy: "USDT", state: "live" },
        ],
      }), { status: 200 });
    }

    if (url.pathname.endsWith("/market/tickers")) {
      if (scenario === "api-error") {
        return new Response(JSON.stringify({ code: "50011", msg: "rate limit", data: [] }), { status: 200 });
      }
      if (scenario === "malformed-data") {
        return new Response(JSON.stringify({ code: "0", msg: "", data: {} }), { status: 200 });
      }
      return new Response(JSON.stringify({
        code: "0",
        msg: "",
        data: [
          { instId: "BTC-USDT", bidPx: "65000", askPx: "65010", last: "65005" },
          { instId: "ETH-USD", bidPx: "3000", askPx: "0", last: "3001" },
          { instId: "DOGE-USDT", bidPx: "0.1", askPx: "0.11", last: "0.105" },
        ],
      }), { status: 200 });
    }

    if (url.pathname.endsWith("/market/books")) {
      if (scenario === "http-error") return new Response("unavailable", { status: 429 });
      if (scenario === "api-error") {
        return new Response(JSON.stringify({ code: "51000", msg: "invalid instrument", data: [] }), { status: 200 });
      }
      if (scenario === "empty-book") {
        return new Response(JSON.stringify({ code: "0", msg: "", data: [] }), { status: 200 });
      }
      const timestamp = scenario === "stale-book" ? Date.now() - 31_000 : Date.now();
      return new Response(JSON.stringify({
        code: "0",
        msg: "",
        data: [{
          asks: [["101", "2"], ["100", "1"], ["0", "5"]],
          bids: [["99", "3"], ["98", "4"]],
          ts: String(timestamp),
        }],
      }), { status: 200 });
    }

    throw new Error(`Unexpected OKX URL: ${url}`);
  }) as typeof fetch;

  try {
    const pairs = await okx.discoverPairs();
    assert.deepEqual(pairs.sort(), ["BTC/USDT", "ETH/USD"]);
    assert.equal(requested.length, 1);

    const tickers = await okx.tickers(["BTC/USDT", "ETH/USD", "DOGE/USDT"]);
    assert.equal(tickers.size, 1, "invalid or unconfigured ticker rows must be ignored");
    assert.deepEqual(tickers.get("BTC/USDT"), {
      venue: "okx",
      pair: "BTC/USDT",
      bid: 65000,
      ask: 65010,
      last: 65005,
      ts: tickers.get("BTC/USDT")!.ts,
    });

    const book = await okx.book("BTC/USDT", 2);
    assert.equal(book.venue, "okx");
    assert.equal(book.pair, "BTC/USDT");
    assert.deepEqual(book.asks, [{ price: 100, size: 1 }, { price: 101, size: 2 }]);
    assert.deepEqual(book.bids, [{ price: 99, size: 3 }, { price: 98, size: 4 }]);
    assert.ok(book.ts > 0);
    assert.equal(new URL(requested.at(-1)!).searchParams.get("sz"), "2");

    const beforeUnknownPair = requested.length;
    await assert.rejects(() => okx.book("DOGE/USDT"), /coppia DOGE\/USDT non disponibile/);
    assert.equal(requested.length, beforeUnknownPair, "unknown pairs must not trigger network calls");

    scenario = "empty-book";
    await assert.rejects(() => okx.book("BTC/USDT"), /order book vuoto/);

    scenario = "stale-book";
    await assert.rejects(() => okx.book("BTC/USDT"), /snapshot order book troppo vecchio/);

    scenario = "api-error";
    await assert.rejects(() => okx.book("BTC/USDT"), /OKX API 51000/);
    await assert.rejects(() => okx.tickers(["BTC/USDT"]), /OKX API 50011/);

    scenario = "http-error";
    await assert.rejects(() => okx.book("BTC/USDT"), /OKX HTTP 429/);

    scenario = "malformed-data";
    await assert.rejects(() => okx.tickers(["BTC/USDT"]), /risposta dati non valida/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
