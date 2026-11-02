import assert from "node:assert/strict";
import test, { after } from "node:test";
import { isOkxSmokeEnabled, runOkxSmoke, runOkxSmokeIfEnabled } from "../src/lib/venues/okx-smoke";

const realFetch = globalThis.fetch;

after(() => {
  globalThis.fetch = realFetch;
});

type Call = { url: URL; redirect?: RequestRedirect; authorization: boolean };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stub(handler: (url: URL) => Response) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    calls.push({ url, redirect: init?.redirect as RequestRedirect | undefined, authorization: new Headers(init?.headers).has("Authorization") });
    return handler(url);
  }) as typeof fetch;
  return calls;
}

const instruments = () => ({
  code: "0",
  msg: "",
  data: [
    { instId: "BTC-EUR", baseCcy: "BTC", quoteCcy: "EUR", state: "live" },
    { instId: "ETH-EUR", baseCcy: "ETH", quoteCcy: "EUR", state: "live" },
  ],
});

const tickers = () => ({
  code: "0",
  msg: "",
  data: [
    { instId: "BTC-EUR", bidPx: "68000", askPx: "68010", last: "68005" },
    { instId: "ETH-EUR", bidPx: "2000", askPx: "2001", last: "2000.5" },
  ],
});

const book = (ts = String(Date.now())) => ({
  code: "0",
  msg: "",
  data: [{ asks: [["68010", "1"]], bids: [["68000", "1"]], ts }],
});

const fast = { sleep: async () => {} };

test("okx smoke: disabled by default and never touches the network", async () => {
  const calls = stub(() => {
    throw new Error("rete non consentita");
  });

  for (const value of [undefined, "", "1", "false", "yes", "0"]) {
    assert.equal(isOkxSmokeEnabled(value), false, `gate must stay closed for ${String(value)}`);
    const report = await runOkxSmokeIfEnabled(value, fast);
    assert.equal(report.skipped, true);
    assert.equal(report.ok, true);
    assert.equal(report.requests, 0);
  }
  assert.equal(calls.length, 0, "no request without an explicit GM_OKX_SMOKE=true");
  assert.equal(isOkxSmokeEnabled(" TRUE "), true);
});

test("okx smoke: a healthy response passes every check", async () => {
  const calls = stub((url) => {
    if (url.pathname.endsWith("/public/instruments")) return json(instruments());
    if (url.pathname.endsWith("/market/tickers")) return json(tickers());
    return json(book());
  });

  const report = await runOkxSmoke(fast);
  assert.equal(report.ok, true);
  assert.equal(report.requests, 3);
  assert.equal(report.pair, "BTC/EUR");
  assert.equal(report.instId, "BTC-EUR");
  assert.equal(report.bid, 68000);
  assert.equal(report.ask, 68010);
  assert.ok((report.bookAgeMs ?? -1) >= 0);
  assert.ok(report.checks.every((check) => check.ok));

  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.redirect === "error"), "every request must refuse redirects");
  assert.ok(calls.every((call) => call.authorization === false), "no credentials on public market data");
  assert.equal(calls.at(-1)!.url.searchParams.get("instId"), "BTC-EUR");
});

test("okx smoke: a redirect is refused instead of being followed", async () => {
  const calls = stub(() => {
    throw new TypeError("fetch failed: unexpected redirect");
  });

  const report = await runOkxSmoke(fast);
  assert.equal(report.ok, false);
  assert.equal(report.checks[0]!.name, "instruments");
  assert.match(report.checks[0]!.detail, /unexpected redirect/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.redirect, "error");
});

test("okx smoke: a 200 served from another origin is rejected", async () => {
  stub(() => {
    const res = new Response(JSON.stringify(instruments()), { status: 200 });
    Object.defineProperty(res, "url", { value: "https://www.okx.com/api/v5/public/instruments?instType=SPOT" });
    return res;
  });

  const report = await runOkxSmoke(fast);
  assert.equal(report.ok, false);
  assert.match(report.checks[0]!.detail, /origine inattesa https:\/\/www\.okx\.com/);
});

test("okx smoke: a non-200 status fails the run", async () => {
  stub(() => new Response("unavailable", { status: 500 }));
  const report = await runOkxSmoke(fast);
  assert.equal(report.ok, false);
  assert.match(report.checks[0]!.detail, /HTTP 500/);
});

test("okx smoke: a non-zero API code fails the run", async () => {
  stub(() => json({ code: "50011", msg: "rate limit", data: [] }));
  const report = await runOkxSmoke(fast);
  assert.equal(report.ok, false);
  assert.match(report.checks[0]!.detail, /code 50011/);
});

test("okx smoke: a payload that is not a list fails the run", async () => {
  stub(() => json({ code: "0", msg: "", data: {} }));
  const report = await runOkxSmoke(fast);
  assert.equal(report.ok, false);
  assert.match(report.checks[0]!.detail, /data non è una lista/);
});

test("okx smoke: instruments missing a required field fail the run", async () => {
  stub(() => json({ code: "0", msg: "", data: [{ instId: "BTC-EUR", quoteCcy: "EUR", state: "live" }] }));
  const report = await runOkxSmoke(fast);
  assert.equal(report.ok, false);
  assert.match(report.checks[0]!.detail, /senza instId\/baseCcy\/quoteCcy\/state/);
});

test("okx smoke: a ticker missing for the discovered instrument fails the run", async () => {
  stub((url) => {
    if (url.pathname.endsWith("/public/instruments")) return json(instruments());
    return json({ code: "0", msg: "", data: [{ instId: "ETH-EUR", bidPx: "2000", askPx: "2001", last: "2000.5" }] });
  });

  const report = await runOkxSmoke(fast);
  assert.equal(report.ok, false);
  assert.equal(report.checks.at(-1)!.name, "tickers");
  assert.match(report.checks.at(-1)!.detail, /ticker assente per BTC-EUR/);
});

test("okx smoke: a ticker with an unusable price fails the run", async () => {
  stub((url) => {
    if (url.pathname.endsWith("/public/instruments")) return json(instruments());
    return json({ code: "0", msg: "", data: [{ instId: "BTC-EUR", bidPx: "0", askPx: "68010", last: "0" }] });
  });

  const report = await runOkxSmoke(fast);
  assert.equal(report.ok, false);
  assert.match(report.checks.at(-1)!.detail, /bid\/ask non validi/);
});

test("okx smoke: a stale order book fails the run", async () => {
  stub((url) => {
    if (url.pathname.endsWith("/public/instruments")) return json(instruments());
    if (url.pathname.endsWith("/market/tickers")) return json(tickers());
    return json(book(String(Date.now() - 31_000)));
  });

  const report = await runOkxSmoke(fast);
  assert.equal(report.ok, false);
  assert.match(report.checks.at(-1)!.detail, /snapshot vecchio/);
});
