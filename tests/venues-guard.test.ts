import assert from "node:assert/strict";
import test, { after } from "node:test";
import { execFile } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { assertAllowedVenueBase, VenueHostError } from "../src/lib/venues/hosts";
import { bybit } from "../src/lib/venues/bybit";
import { coinbase } from "../src/lib/venues/coinbase";
import { kraken } from "../src/lib/venues/kraken";

const realFetch = globalThis.fetch;

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const runNode = promisify(execFile);

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

/**
 * Real local socket: proves the runtime itself refuses a 3xx when the adapter asks for
 * `redirect: "error"`. The per-adapter tests below can only emulate that rejection, so this
 * test is the one that exercises actual HTTP redirect handling.
 */
type Server = { url: string; readonly hits: number; close: () => Promise<void> };

function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<Server> {
  return new Promise((resolve, reject) => {
    let hits = 0;
    const server = createServer((req, res) => {
      hits += 1;
      handler(req, res);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("porta effimera non assegnata"));
        return;
      }
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        get hits() {
          return hits;
        },
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

test("redirect: \"error\" really rejects a served 3xx instead of following it", async () => {
  const collector = await startServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  const redirector = await startServer((req, res) => {
    const status = Number(new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get("s") ?? 302);
    res.writeHead(status, { location: collector.url });
    res.end();
  });

  try {
    for (const status of [301, 302, 303, 307, 308]) {
      await assert.rejects(
        () => fetch(`${redirector.url}/?s=${status}`, { redirect: "error" }),
        (err: unknown) => err instanceof TypeError,
        `status ${status} must be refused, not followed`,
      );
    }
    assert.equal(redirector.hits, 5);
    assert.equal(collector.hits, 0, "nessun 3xx deve essere seguito con redirect:error");

    // Control: the very same 3xx is reachable and followed without the guard, so the
    // assertions above prove the guard is what stops it rather than a broken stub.
    const followed = await fetch(`${redirector.url}/?s=302`, { redirect: "follow" });
    assert.equal(followed.status, 200);
    assert.equal(collector.hits, 1);
  } finally {
    await redirector.close();
    await collector.close();
  }
});

test("adapters reject a 3xx Response instead of parsing its body as data", async () => {
  const calls = stub(
    () => new Response(null, { status: 302, headers: { location: "https://evil.example/collect" } }),
  );

  await assert.rejects(() => kraken.book("BTC/EUR"), /Kraken HTTP 302/);
  await assert.rejects(() => coinbase.book("BTC/EUR"), /Coinbase HTTP 302/);
  await assert.rejects(() => bybit.book("BTC/USDT"), /Bybit HTTP 302/);

  assert.ok(calls.every((call) => call.redirect === "error"));
  assert.ok(
    calls.every((call) =>
      ["https://api.kraken.com", "https://api.exchange.coinbase.com", "https://api.bybit.eu"].includes(
        call.url.origin,
      ),
    ),
    "nessuna richiesta deve finire sull'host del redirect",
  );
});

test("bybit: an unauthorised BYBIT_API_BASE fails while the module loads", async () => {
  const loadBybit = (value: string | undefined) =>
    runNode(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        "await import('./src/lib/venues/bybit.ts'); console.log('bybit module loaded');",
      ],
      {
        cwd: projectRoot,
        env: value === undefined ? { ...process.env } : { ...process.env, BYBIT_API_BASE: value },
        timeout: 60_000,
      },
    );

  // An excluded host, an authenticated API and a plain-http origin must all stop the import:
  // the guard runs at module scope, so a bad override can never reach a single request.
  for (const value of ["https://evil.example", "https://api.coinbase.com", "http://api.bybit.eu"]) {
    await assert.rejects(
      loadBybit(value),
      (err: unknown) => {
        const failure = err as { code?: number; stderr?: string };
        assert.notEqual(failure.code ?? 0, 0, `BYBIT_API_BASE=${value} deve far fallire il caricamento`);
        assert.match(String(failure.stderr), /BYBIT_API_BASE/);
        assert.ok(
          /non in ALLOWED_VENUE_HOSTS|solo https/.test(String(failure.stderr)),
          `errore inatteso per BYBIT_API_BASE=${value}`,
        );
        return true;
      },
      `BYBIT_API_BASE=${value} must abort the module load`,
    );
  }

  // An approved override still loads, so the assertion above is about the allowlist and not
  // about the child process being unable to import the module at all.
  const approved = await loadBybit("https://api.bytick.com");
  assert.match(String(approved.stdout), /bybit module loaded/);
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
