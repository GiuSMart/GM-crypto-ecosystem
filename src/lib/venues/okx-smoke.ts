import { ASSETS, QUOTES } from "../config";

/**
 * Optional read-only smoke test for OKX EEA Spot public market data.
 *
 * It touches only /public/instruments, /market/tickers and /market/books: no API key,
 * no Authorization header, no private endpoint, no order, deposit or withdrawal.
 * It never runs on its own — the caller must opt in with GM_OKX_SMOKE=true.
 */
export const OKX_SMOKE_ENV = "GM_OKX_SMOKE";
export const OKX_SMOKE_ORIGIN = "https://eea.okx.com";
export const OKX_SMOKE_TIMEOUT_MS = 9000;
export const OKX_SMOKE_MAX_BOOK_AGE_MS = 30_000;
export const OKX_SMOKE_MAX_FUTURE_SKEW_MS = 5000;

const SPACING_MS = 150;
const UA = "GM-Crypto-Arbitrage-AI/0.3 (+public Spot market data only)";

export type SmokeCheck = { name: string; ok: boolean; detail: string };

export type SmokeReport = {
  skipped: boolean;
  ok: boolean;
  requests: number;
  durationMs: number;
  checks: SmokeCheck[];
  pair?: string;
  instId?: string;
  bid?: number;
  ask?: number;
  bookAgeMs?: number;
};

type SmokeOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

type InstrumentRow = { instId?: string; baseCcy?: string; quoteCcy?: string; state?: string };
type TickerRow = { instId?: string; bidPx?: string; askPx?: string; last?: string };
type BookRow = { asks?: string[][]; bids?: string[][]; ts?: string };

class SmokeFailure extends Error {}

/** Same contract as isWorkerEnabled: only an explicit "true" switches it on. */
export function isOkxSmokeEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function runOkxSmoke(options: SmokeOptions = {}): Promise<SmokeReport> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? delay;
  const startedAt = now();
  const checks: SmokeCheck[] = [];
  let requests = 0;
  let lastRequestAt = 0;

  const report = (ok: boolean, extra: Partial<SmokeReport> = {}): SmokeReport => ({
    skipped: false,
    ok,
    requests,
    durationMs: now() - startedAt,
    checks,
    ...extra,
  });

  const pass = (name: string, detail: string) => checks.push({ name, ok: true, detail });

  const request = async (path: string): Promise<unknown[]> => {
    if (lastRequestAt) await sleep(SPACING_MS);
    lastRequestAt = now();
    requests += 1;

    const target = new URL(path, OKX_SMOKE_ORIGIN);
    let res: Response;
    try {
      res = await fetchImpl(target.toString(), {
        // eea.okx.com redirects non-API paths to www.okx.com, which serves the same
        // payloads: a followed redirect would validate the wrong host and still pass.
        redirect: "error",
        headers: { "User-Agent": UA, Accept: "application/json" },
        cache: "no-store",
        signal: AbortSignal.timeout(OKX_SMOKE_TIMEOUT_MS),
      });
    } catch (err) {
      throw new SmokeFailure(`richiesta ${target.pathname} rifiutata: ${(err as Error).message}`);
    }
    if (res.status !== 200) throw new SmokeFailure(`HTTP ${res.status} su ${target.pathname}`);
    if (res.url) {
      const final = new URL(res.url);
      if (final.origin !== OKX_SMOKE_ORIGIN) {
        throw new SmokeFailure(`origine inattesa ${final.origin} su ${target.pathname}`);
      }
      if (final.pathname !== target.pathname) {
        throw new SmokeFailure(`percorso deviato ${final.pathname} su ${target.pathname}`);
      }
    }

    let body: { code?: unknown; msg?: unknown; data?: unknown };
    try {
      body = (await res.json()) as typeof body;
    } catch {
      throw new SmokeFailure(`risposta non JSON su ${target.pathname}`);
    }
    if (body.code !== "0") throw new SmokeFailure(`code ${String(body.code)} su ${target.pathname}: ${String(body.msg ?? "")}`);
    if (!Array.isArray(body.data)) throw new SmokeFailure(`data non è una lista su ${target.pathname}`);
    if (body.data.length === 0) throw new SmokeFailure(`data vuota su ${target.pathname}`);
    return body.data;
  };

  const step = async <T>(name: string, run: () => Promise<T>): Promise<T | null> => {
    try {
      return await run();
    } catch (err) {
      checks.push({ name, ok: false, detail: err instanceof SmokeFailure ? err.message : String(err) });
      return null;
    }
  };

  const eligible = await step("instruments", async () => {
    const rows = (await request("/api/v5/public/instruments?instType=SPOT")) as InstrumentRow[];
    const incomplete = rows.filter((row) => !row.instId || !row.baseCcy || !row.quoteCcy || !row.state).length;
    if (incomplete > 0) throw new SmokeFailure(`${incomplete} strumenti senza instId/baseCcy/quoteCcy/state`);
    const live = rows.filter(
      (row) =>
        row.state === "live" &&
        (ASSETS as readonly string[]).includes(row.baseCcy!) &&
        (QUOTES as readonly string[]).includes(row.quoteCcy!),
    );
    if (!live.length) throw new SmokeFailure("nessuno strumento Spot live compatibile con ASSETS/QUOTES");
    pass("instruments", `${rows.length} strumenti Spot, ${live.length} live compatibili`);
    return live;
  });
  if (!eligible) return report(false);

  const chosen = eligible[0]!;

  const ticker = await step("tickers", async () => {
    const rows = (await request("/api/v5/market/tickers?instType=SPOT")) as TickerRow[];
    const malformed = rows.filter(
      (row) =>
        typeof row.instId !== "string" ||
        typeof row.bidPx !== "string" ||
        typeof row.askPx !== "string" ||
        typeof row.last !== "string",
    ).length;
    if (malformed > 0) throw new SmokeFailure(`${malformed} ticker senza instId o con prezzi non stringa`);

    // The ticker must be the exact instrument the discovery just announced as live:
    // no fallback to a reconstructed pair name and no silent skip.
    const row = rows.find((entry) => entry.instId === chosen.instId);
    if (!row) throw new SmokeFailure(`ticker assente per ${chosen.instId}, annunciato live dalla discovery`);
    const bid = Number(row.bidPx);
    const ask = Number(row.askPx);
    if (!(bid > 0) || !(ask > 0) || ask < bid) {
      throw new SmokeFailure(`bid/ask non validi per ${chosen.instId}: ${row.bidPx}/${row.askPx}`);
    }
    pass("tickers", `${rows.length} ticker, ${chosen.instId} bid ${bid} ask ${ask}`);
    return { bid, ask };
  });
  if (!ticker) return report(false);

  const snapshot = await step("books", async () => {
    const rows = (await request(`/api/v5/market/books?instId=${encodeURIComponent(chosen.instId!)}&sz=5`)) as BookRow[];
    if (rows.length !== 1) throw new SmokeFailure(`atteso 1 snapshot, ricevuti ${rows.length}`);
    const book = rows[0]!;
    if (!Array.isArray(book.asks) || !Array.isArray(book.bids) || !book.asks.length || !book.bids.length) {
      throw new SmokeFailure(`order book vuoto o monolatero per ${chosen.instId}`);
    }
    const exchangeTs = Number(book.ts);
    if (!Number.isFinite(exchangeTs) || exchangeTs <= 0) {
      throw new SmokeFailure("timestamp del book mancante o non valido");
    }
    const receivedAt = now();
    if (exchangeTs > receivedAt + OKX_SMOKE_MAX_FUTURE_SKEW_MS) {
      throw new SmokeFailure(`timestamp del book nel futuro di ${exchangeTs - receivedAt} ms`);
    }
    const age = receivedAt - exchangeTs;
    if (age > OKX_SMOKE_MAX_BOOK_AGE_MS) {
      throw new SmokeFailure(`snapshot vecchio di ${age} ms (limite ${OKX_SMOKE_MAX_BOOK_AGE_MS} ms)`);
    }
    pass("books", `${book.asks.length} ask / ${book.bids.length} bid, età ${age} ms`);
    return { age };
  });
  if (!snapshot) return report(false);

  return report(true, {
    pair: `${chosen.baseCcy}/${chosen.quoteCcy}`,
    instId: chosen.instId,
    bid: ticker.bid,
    ask: ticker.ask,
    bookAgeMs: snapshot.age,
  });
}

export async function runOkxSmokeIfEnabled(value: string | undefined, options: SmokeOptions = {}): Promise<SmokeReport> {
  if (!isOkxSmokeEnabled(value)) {
    return {
      skipped: true,
      ok: true,
      requests: 0,
      durationMs: 0,
      checks: [{ name: "attivazione", ok: true, detail: `${OKX_SMOKE_ENV} diverso da "true": nessuna richiesta effettuata` }],
    };
  }
  return runOkxSmoke(options);
}
