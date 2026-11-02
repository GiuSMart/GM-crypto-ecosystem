import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test, { after, before } from "node:test";

/**
 * End-to-end test of the bootstrap-password gate.
 *
 * The route handlers resolve the session through `next/headers`, so they can only
 * run inside a real request scope: calling `POST()` directly would throw before
 * reaching the guard. This suite therefore boots the *built* application and talks
 * to it over HTTP, exactly like a browser does.
 *
 * It seeds a throwaway database in a temp directory. The admin password is passed
 * through GM_ADMIN_PASSWORD so the test never reads a credentials file, and the
 * value is only ever used as a request body — never printed.
 */

const ROOT = process.cwd();
const ADMIN_EMAIL = "admin@gmarbitrage.ai";
const ADMIN_PASSWORD = "Bootstrap-Check-1";
const NEW_PASSWORD = "Rotated-Check-2";
const COOKIE_NAME = "gm_session";
const GATE_MESSAGE = "Cambia la password iniziale prima di modificare i dati.";

let server: ChildProcess | null = null;
let baseUrl = "";
let dataDir = "";
let dbPath = "";
let serverLog = "";
let bootstrapCookie = "";

type JsonBody = { ok?: boolean; error?: string; data?: any } | null;

type ApiResult = {
  status: number;
  json: JsonBody;
  cookie: string;
};

async function api(
  pathname: string,
  opts: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<ApiResult> {
  const res = await fetch(baseUrl + pathname, {
    method: opts.method ?? "GET",
    headers: {
      "content-type": "application/json",
      // Cookie-authenticated mutations reject anything that is not same-origin.
      "sec-fetch-site": "same-origin",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    redirect: "manual",
  });
  const text = await res.text();
  let json: JsonBody = null;
  try {
    json = JSON.parse(text) as JsonBody;
  } catch {
    json = null;
  }
  const setCookie = res.headers.get("set-cookie") ?? "";
  return { status: res.status, json, cookie: setCookie ? setCookie.split(";")[0] : "" };
}

/** Read-only probe of the server's database, to prove what was (not) written. */
function dbGet<T>(sql: string, ...params: Array<string | number>): T | undefined {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(sql).get(...params) as T | undefined;
  } finally {
    db.close();
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

before(async () => {
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  assert.ok(fs.existsSync(nextBin), "Next.js non è installato: esegui `npm ci`");
  assert.ok(
    fs.existsSync(path.join(ROOT, ".next", "BUILD_ID")),
    "serve una build di produzione: `npm run build` va eseguito prima di `npm run test:api`",
  );

  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-api-gate-"));
  dbPath = path.join(dataDir, "gm.db");
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port), "-H", "127.0.0.1"], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "production",
      GM_DATA_DIR: dataDir,
      GM_DB_PATH: dbPath,
      GM_ADMIN_PASSWORD: ADMIN_PASSWORD,
      GM_DEMO_PASSWORD: "Demo-Check-1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server = child;
  child.stdout?.on("data", (chunk: Buffer) => {
    serverLog += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    serverLog += chunk.toString();
  });

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`${baseUrl}/login`, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`il server non è diventato pronto.\n${serverLog.slice(-2000)}`);
});

after(async () => {
  const child = server;
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
});

test("l'admin del seed accede con la password iniziale e deve cambiarla", async () => {
  const res = await api("/api/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });

  assert.equal(res.status, 200);
  assert.equal(res.json?.ok, true);
  assert.equal(res.json?.data?.mustChangePassword, true);
  assert.ok(res.cookie.startsWith(`${COOKIE_NAME}=`), "il login deve emettere il cookie di sessione");
  bootstrapCookie = res.cookie;
});

test("prima del cambio password ogni mutazione amministrativa è bloccata e non scrive nulla", async () => {
  assert.ok(bootstrapCookie, "serve la sessione ottenuta nel test precedente");

  const planBefore = dbGet<{ price_cents: number }>("SELECT price_cents FROM plans WHERE id = 'premium'");
  assert.ok(planBefore, "il piano premium deve esistere nel seed");

  // Admin-only: cambierebbe il listino.
  const price = await api("/api/admin", {
    method: "POST",
    cookie: bootstrapCookie,
    body: { action: "set_plan_price", planId: "premium", priceCents: 8123 },
  });
  assert.equal(price.status, 403);
  assert.equal(price.json?.ok, false);
  assert.equal(price.json?.error, GATE_MESSAGE);

  // Fee override: scriverebbe in fee_overrides.
  const fees = await api("/api/fees", {
    method: "POST",
    cookie: bootstrapCookie,
    body: { venueId: "kraken", makerPct: 0.25, takerPct: 0.42, note: "bootstrap gate test" },
  });
  assert.equal(fees.status, 403);
  assert.equal(fees.json?.error, GATE_MESSAGE);

  // Wallet: scriverebbe in wallets.
  const wallet = await api("/api/wallets", {
    method: "POST",
    cookie: bootstrapCookie,
    body: { platform: "phantom", label: "Gate test", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" },
  });
  assert.equal(wallet.status, 403);
  assert.equal(wallet.json?.error, GATE_MESSAGE);

  // La protezione deve fermare l'effetto, non solo la risposta.
  const planAfter = dbGet<{ price_cents: number }>("SELECT price_cents FROM plans WHERE id = 'premium'");
  assert.equal(planAfter?.price_cents, planBefore.price_cents, "il prezzo del piano non deve cambiare");
  assert.equal(dbGet<{ n: number }>("SELECT COUNT(*) AS n FROM fee_overrides")?.n, 0);
  assert.equal(dbGet<{ n: number }>("SELECT COUNT(*) AS n FROM wallets")?.n, 0);
});

test("una password attuale errata o una nuova password debole non aprono il gate", async () => {
  const wrong = await api("/api/auth/password", {
    method: "POST",
    cookie: bootstrapCookie,
    body: { current: "Password-Sbagliata-1", next: NEW_PASSWORD },
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json?.ok, false);

  const stillBlocked = await api("/api/admin", {
    method: "POST",
    cookie: bootstrapCookie,
    body: { action: "set_plan_price", planId: "premium", priceCents: 8123 },
  });
  assert.equal(stillBlocked.status, 403);
  assert.equal(stillBlocked.json?.error, GATE_MESSAGE);

  const weak = await api("/api/auth/password", {
    method: "POST",
    cookie: bootstrapCookie,
    body: { current: ADMIN_PASSWORD, next: "corta" },
  });
  assert.equal(weak.status, 400);
  assert.equal(weak.json?.ok, false);

  const afterWeak = await api("/api/admin", {
    method: "POST",
    cookie: bootstrapCookie,
    body: { action: "set_plan_price", planId: "premium", priceCents: 8123 },
  });
  assert.equal(afterWeak.status, 403);
  assert.equal(afterWeak.json?.error, GATE_MESSAGE);
});

test("dopo il cambio password le operazioni autorizzate funzionano davvero", async () => {
  const changed = await api("/api/auth/password", {
    method: "POST",
    cookie: bootstrapCookie,
    body: { current: ADMIN_PASSWORD, next: NEW_PASSWORD },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.json?.data?.changed, true);
  assert.ok(changed.cookie.startsWith(`${COOKIE_NAME}=`), "il cambio password deve rinnovare la sessione");
  assert.notEqual(changed.cookie, bootstrapCookie, "deve essere emesso un nuovo token di sessione");

  const rotatedCookie = changed.cookie;

  const price = await api("/api/admin", {
    method: "POST",
    cookie: rotatedCookie,
    body: { action: "set_plan_price", planId: "premium", priceCents: 8123 },
  });
  assert.equal(price.status, 200);
  assert.equal(price.json?.ok, true);
  assert.equal(dbGet<{ price_cents: number }>("SELECT price_cents FROM plans WHERE id = 'premium'")?.price_cents, 8123);

  const fees = await api("/api/fees", {
    method: "POST",
    cookie: rotatedCookie,
    body: { venueId: "kraken", makerPct: 0.25, takerPct: 0.42, note: "post-rotation test" },
  });
  assert.equal(fees.status, 200);
  assert.equal(fees.json?.data?.takerPct, 0.42);
  assert.equal(
    dbGet<{ taker_pct: number }>("SELECT taker_pct FROM fee_overrides WHERE venue_id = 'kraken' ORDER BY rowid DESC LIMIT 1")
      ?.taker_pct,
    0.42,
  );

  const wallet = await api("/api/wallets", {
    method: "POST",
    cookie: rotatedCookie,
    body: { platform: "phantom", label: "Post rotation", address: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" },
  });
  assert.equal(wallet.status, 200);
  assert.equal(wallet.json?.ok, true);

  const list = await api("/api/wallets", { cookie: rotatedCookie });
  assert.equal(list.status, 200);
  assert.equal(list.json?.data?.length, 1);
});

test("la sessione precedente è revocata e il nuovo login non richiede più il cambio", async () => {
  const oldSession = await api("/api/admin", {
    method: "POST",
    cookie: bootstrapCookie,
    body: { action: "set_plan_price", planId: "premium", priceCents: 1 },
  });
  assert.equal(oldSession.status, 401, "il token emesso prima del cambio password deve essere revocato");

  const relogin = await api("/api/auth/login", {
    method: "POST",
    body: { email: ADMIN_EMAIL, password: NEW_PASSWORD },
  });
  assert.equal(relogin.status, 200);
  assert.equal(relogin.json?.data?.mustChangePassword, false);
  assert.equal(dbGet<{ must_change_password: number }>("SELECT must_change_password FROM users WHERE email = ?", ADMIN_EMAIL)
    ?.must_change_password, 0);
});
