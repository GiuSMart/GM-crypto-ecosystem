import assert from "node:assert/strict";
import test, { after } from "node:test";
import { assertAllowedVenueBase, VenueHostError } from "../src/lib/venues/hosts";
import { bybit } from "../src/lib/venues/bybit";
import { coinbase } from "../src/lib/venues/coinbase";
import { kraken } from "../src/lib/venues/kraken";

const realFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: URL; redirect?: RequestRedirect; authorization: boolean };

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function stub(handler: (url: URL) => Response) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    calls.push({
      url,
      redirect: init?.redirect as RequestRedirect | undefined,
      authorization: new Headers(init?.headers).has("Authorization"),
    });
    return handler(url);
  }) as typeof fetch;
  return calls;
}

test("venue guard: accepts the approved public market-data origins", () => {
  for (const origin of [
    "https://api.kraken.com",
    "https://api.exchange.coinbase.com",
    "https://api.bybit.eu",
    "https://api.bytick.com",
  ]) {
    assert.equal(assertAllowedVenueBase(origin).origin, origin);
  }
});

test("venue guard: rejects a non-https scheme", () => {
  assert.throws(() => assertAllowedVenueBase("http://api.kraken.com"), VenueHostError);
  assert.throws(() => assertAllowedVenueBase("http://api.kraken.com"), /solo https/);
});

test("venue guard: rejects hosts outside the allowlist", () => {
  assert.throws(() => assertAllowedVenueBase("https://api.binance.com"), /non in ALLOWED_VENUE_HOSTS/);
  // Authenticated brokerage API: not public market data, removed from the list on purpose.
  assert.throws(() => assertAllowedVenueBase("https://api.coinbase.com"), /non in ALLOWED_VENUE_HOSTS/);
});

test("venue guard: rejects path, port, credentials and query", () => {
  assert.throws(() => assertAllowedVenueBase("https://api.kraken.com/0/public"), /percorso/);
  assert.throws(() => assertAllowedVenueBase("https://api.kraken.com:8443"), /porta/);
  assert.throws(() => assertAllowedVenueBase("https://user:pass@api.kraken.com"), /credenziali/);
  assert.throws(() => assertAllowedVenueBase("https://api.kraken.com?redirect=evil"), /query/);
});

test("venue guard: rejects malformed or empty input with a readable error", () => {
  assert.throws(() => assertAllowedVenueBase("not a url"), /URL non valida/);
  assert.throws(() => assertAllowedVenueBase(""), /URL non valida o vuota/);
  assert.throws(() => assertAllowedVenueBase("http://api.bybit.eu", "BYBIT_API_BASE"), /BYBIT_API_BASE/);
});

test("kraken: public requests refuse redirects and stay on the approved origin", async () => {
  let redirectMode = false;
  const stamp = Math.floor(Date.now() / 1000);
  const calls = stub((url) => {
    if (redirectMode) throw new TypeError("fetch failed: unexpected redirect");
    if (url.pathname.endsWith("/AssetPairs")) {
      return json({
        error: [],
        result: { XXBTZEUR: { altname: "XBTEUR", wsname: "XBT/EUR", base: "XXBT", quote: "ZEUR", status: "online" } },
      });
    }
    return json({ error: [], result: { XXBTZEUR: { asks: [["101", "1", stamp]], bids: [["100", "1", stamp]] } } });
  });

  await kraken.book("BTC/EUR", 5);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => call.redirect === "error"), "kraken must refuse redirects");
  assert.ok(calls.every((call) => call.url.origin === "https://api.kraken.com"));
  assert.ok(calls.every((call) => call.authorization === false));

  redirectMode = true;
  await assert.rejects(() => kraken.book("BTC/EUR"), /unexpected redirect/);
});

test("coinbase: public requests refuse redirects and stay on the approved origin", async () => {
  let redirectMode = false;
  const calls = stub((url) => {
    if (redirectMode) throw new TypeError("fetch failed: unexpected redirect");
    if (url.pathname === "/products") {
      return json([{ id: "BTC-EUR", base_currency: "BTC", quote_currency: "EUR", status: "online" }]);
    }
    if (url.pathname.endsWith("/ticker")) return json({ bid: "100", ask: "101", price: "100.5" });
    return json({ asks: [["101", "1"]], bids: [["100", "1"]] });
  });

  await coinbase.book("BTC/EUR", 5);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => call.redirect === "error"), "coinbase must refuse redirects");
  assert.ok(calls.every((call) => call.url.origin === "https://api.exchange.coinbase.com"));
  assert.ok(calls.every((call) => call.authorization === false));

  redirectMode = true;
  await assert.rejects(() => coinbase.book("BTC/EUR"), /unexpected redirect/);
});

test("bybit: public requests refuse redirects and stay on the approved origin", async () => {
  let redirectMode = false;
  const calls = stub((url) => {
    if (redirectMode) throw new TypeError("fetch failed: unexpected redirect");
    if (url.pathname.endsWith("/instruments-info")) {
      return json({ retCode: 0, retMsg: "OK", result: { list: [{ symbol: "BTCUSDT", baseCoin: "BTC", quoteCoin: "USDT", status: "Trading" }] } });
    }
    return json({ retCode: 0, retMsg: "OK", result: { s: "BTCUSDT", b: [["100", "1"]], a: [["101", "1"]], ts: Date.now() } });
  });

  await bybit.book("BTC/USDT", 5);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => call.redirect === "error"), "bybit must refuse redirects");
  assert.ok(calls.every((call) => call.url.origin === "https://api.bybit.eu"));
  assert.ok(calls.every((call) => call.authorization === false));

  redirectMode = true;
  await assert.rejects(() => bybit.book("BTC/USDT"), /unexpected redirect/);
});
