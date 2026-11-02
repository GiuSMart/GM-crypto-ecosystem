import assert from "node:assert/strict";
import test, { after } from "node:test";
import { kraken } from "../src/lib/venues/kraken";

const realFetch = globalThis.fetch;
const calls: { url: string; authorization: boolean }[] = [];
let bookTsOverride: number | "missing" | null = null;
let bidsEmpty = false;

after(() => {
  globalThis.fetch = realFetch;
});

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const tsSeconds = () => Math.floor(Date.now() / 1000);
const resultKeyByAltname: Record<string, string> = { XBTEUR: "XXBTZEUR", XDGUSD: "XDGUSD", SOLUSD: "SOLUSD" };

function stubKraken() {
  calls.length = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    calls.push({ url: href, authorization: new Headers(init?.headers).has("Authorization") });
    assert.equal(url.origin, "https://api.kraken.com", "public market data must stay on the public host");

    if (url.pathname.endsWith("/AssetPairs")) {
      return json({
        error: [],
        result: {
          XXBTZEUR: { altname: "XBTEUR", wsname: "XBT/EUR", base: "XXBT", quote: "ZEUR", status: "online" },
          XXBTZUSD: { altname: "XBTUSD", wsname: "XBT/USD", base: "XXBT", quote: "ZUSD", status: "online" },
          XDGUSD: { altname: "XDGUSD", wsname: "XDG/USD", base: "XDG", quote: "ZUSD", status: "online" },
          SOLUSD: { altname: "SOLUSD", wsname: "SOL/USD", base: "SOL", quote: "ZUSD", status: "online" },
          ADAEUR: { altname: "ADAEUR", wsname: "ADA/EUR", base: "ADA", quote: "ZEUR", status: "cancel_only" },
        },
      });
    }

    if (url.pathname.endsWith("/Ticker")) {
      return json({
        error: [],
        result: { XXBTZEUR: { a: ["68445.1", "1", "1.0"], b: ["68444.7", "2", "2.0"], c: ["68451.2", "0.01"] } },
      });
    }

    if (url.pathname.endsWith("/Depth")) {
      const altname = url.searchParams.get("pair") ?? "";
      const key = resultKeyByAltname[altname] ?? "UNEXPECTED";
      const stamp = bookTsOverride === "missing" ? undefined : (bookTsOverride ?? tsSeconds());
      const level = (price: string, size: string) => (stamp === undefined ? [price, size] : [price, size, stamp]);
      const asks = [level("68452", "0.2"), level("68451.1", "0.1")];
      const bids = bidsEmpty ? [] : [level("68450", "0.3")];
      return json({ error: [], result: { [key]: { asks, bids } } });
    }

    throw new Error(`Unexpected Kraken URL: ${href}`);
  }) as typeof fetch;
}

test("kraken: discovery normalises legacy prefixes and skips offline pairs", async () => {
  stubKraken();
  bookTsOverride = null;
  bidsEmpty = false;

  const pairs = await kraken.discoverPairs();
  // DOGE/USD is absent on purpose: DOGE is not part of ASSETS, so discovery must not
  // advertise it even though Kraken lists it (XDG prefix).
  assert.deepEqual(pairs.sort(), ["BTC/EUR", "BTC/USD", "SOL/USD"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.authorization, false, "no credentials on public market data");
});

test("kraken: tickers map legacy result keys back to normalised pairs", async () => {
  stubKraken();

  const tickers = await kraken.tickers(["BTC/EUR", "SOL/USD"]);
  assert.deepEqual([...tickers.keys()], ["BTC/EUR"], "SOL has no row in this fixture");
  const btc = tickers.get("BTC/EUR")!;
  assert.equal(btc.bid, 68444.7);
  assert.equal(btc.ask, 68445.1);
  assert.equal(btc.last, 68451.2);
  assert.equal(calls.length, 1, "the pair index is cached for an hour");
  assert.match(new URL(calls[0]!.url).search, /pair=XBTEUR/);
});

test("kraken: unmonitored pairs never touch the network", async () => {
  stubKraken();

  const tickers = await kraken.tickers(["LINK/EUR"]);
  assert.equal(tickers.size, 0);
  assert.equal(calls.length, 0);
});

test("kraken: the book uses the legacy altname and sorts both sides", async () => {
  stubKraken();
  bookTsOverride = tsSeconds();
  bidsEmpty = false;
  const stamp = bookTsOverride;

  const book = await kraken.book("BTC/EUR", 5);
  assert.deepEqual(book.asks, [{ price: 68451.1, size: 0.1 }, { price: 68452, size: 0.2 }]);
  assert.deepEqual(book.bids, [{ price: 68450, size: 0.3 }]);
  assert.equal(book.ts, stamp * 1000, "the snapshot time from Kraken is kept, not the local clock");
  const requested = new URL(calls.at(-1)!.url);
  assert.equal(requested.searchParams.get("pair"), "XBTEUR");
  assert.equal(requested.searchParams.get("count"), "5");
});

test("kraken: an old, future or missing snapshot timestamp is rejected", async () => {
  stubKraken();

  bookTsOverride = "missing";
  await assert.rejects(() => kraken.book("BTC/EUR"), /timestamp del book mancante/);

  bookTsOverride = tsSeconds() - 31;
  await assert.rejects(() => kraken.book("BTC/EUR"), /troppo vecchio/);

  bookTsOverride = tsSeconds() + 60;
  await assert.rejects(() => kraken.book("BTC/EUR"), /timestamp anomalo/);
});

test("kraken: the XDG prefix maps to DOGE and a one-sided book is rejected", async () => {
  stubKraken();
  bookTsOverride = null;
  bidsEmpty = true;

  // DOGE is not monitored, so the lookup only proves the XDG -> DOGE altname mapping;
  // an empty bid side must still be refused rather than priced.
  await assert.rejects(() => kraken.book("DOGE/USD"), /book incompleto/);
  assert.match(new URL(calls.at(-1)!.url).search, /pair=XDGUSD/);
});
