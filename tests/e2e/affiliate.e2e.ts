import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { REFERRALS, REFERRAL_CATEGORIES, REFERRAL_UNCLASSIFIED } from "../../src/lib/config";

/**
 * End-to-end checks for the Affiliate Center against a real production server.
 *
 * These are deliberately NOT part of `npm test`: they boot `next start`, so they
 * need a finished `npm run build` and a few seconds per fixture. Run them with
 * `npm run test:e2e` before a merge or a release.
 *
 * No browser is involved (the build machine has none). The server-rendered HTML
 * is read over HTTP with a real session cookie, which is enough to pin the things
 * that can actually break: which offers are rendered, how they are grouped and
 * ordered, that every card links to its own referral URL, and that the page and
 * the admin API agree on the same catalogue.
 */

const root = process.cwd();
const ADMIN_EMAIL = "admin@gmarbitrage.ai";
const ADMIN_PASSWORD = "Admin-E2E-Test-a1!";
const DEMO_EMAIL = "cliente@demo.it";
const DEMO_PASSWORD = "Demo-E2E-Test-a1!";

/* -------------------------------------------------------------------------- */
/* Server harness                                                             */
/* -------------------------------------------------------------------------- */

async function freePort(): Promise<number> {
  const srv = net.createServer();
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const { port } = srv.address() as net.AddressInfo;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

type Server = { base: string; stop: () => Promise<void>; log: () => string };

async function startServer(dbFile: string, dataDir: string): Promise<Server> {
  if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
    throw new Error("manca un build di produzione: esegui `npm run build` prima di `npm run test:e2e`.");
  }

  const port = await freePort();
  const lines: string[] = [];
  const child: ChildProcess = spawn(
    process.execPath,
    [path.join("node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port), "-H", "127.0.0.1"],
    {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "production",
        GM_DB_PATH: dbFile,
        GM_DATA_DIR: dataDir,
        GM_ADMIN_EMAIL: ADMIN_EMAIL,
        GM_ADMIN_PASSWORD: ADMIN_PASSWORD,
        GM_DEMO_PASSWORD: DEMO_PASSWORD,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout?.on("data", (chunk: Buffer) => lines.push(chunk.toString()));
  child.stderr?.on("data", (chunk: Buffer) => lines.push(chunk.toString()));

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`il server è uscito prima di rispondere:\n${lines.join("")}`);
    try {
      const res = await fetch(`${base}/login`, { redirect: "manual" });
      if (res.status === 200) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`il server non è pronto dopo 90s:\n${lines.join("")}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    base,
    log: () => lines.join(""),
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 5000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

/** Real login through the public endpoint, returning the session cookie pair. */
async function signIn(base: string, email: string, password: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `login ${email} fallito: ${await res.text()}`);
  const cookies = res.headers.getSetCookie().map((c) => c.split(";")[0]!);
  assert.ok(cookies.some((c) => c.startsWith("gm_session=")), "il login deve emettere il cookie di sessione");
  return cookies.join("; ");
}

/* -------------------------------------------------------------------------- */
/* Reading the rendered page                                                  */
/* -------------------------------------------------------------------------- */

type Card = { id: string; name: string; href: string };
type Group = { category: string; count: number; items: Card[] };

const decode = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");

/**
 * Minimal reader for the server-rendered markup. It keys on the elements the page
 * emits for a group header and a card CTA, then walks them in document order, so
 * a card is attributed to the heading that actually precedes it.
 */
function parseAffiliate(html: string): Group[] {
  const headers = [...html.matchAll(/<h2[^>]*>([^<]+)<\/h2>\s*<span class="h-px flex-1"/g)].map((m) => ({
    index: m.index ?? 0,
    category: decode(m[1]!),
  }));

  const cards: { index: number; id: string; href: string; name: string }[] = [];
  for (const anchor of html.matchAll(/<a\s[^>]*>/g)) {
    const tag = anchor[0];
    const id = /data-referral-id="([^"]*)"/.exec(tag)?.[1];
    if (!id) continue;
    const href = /href="([^"]*)"/.exec(tag)?.[1] ?? "";
    const index = anchor.index ?? 0;
    const start = Math.max(0, ...[...headers.map((h) => h.index)].filter((h) => h < index));
    const names = [...html.slice(start, index).matchAll(/class="text-sm font-semibold text-paper">([^<]*)</g)];
    cards.push({ index, id, href: decode(href), name: decode(names.at(-1)?.[1] ?? "") });
  }

  return headers.map((header, i) => {
    const end = headers[i + 1]?.index ?? html.length;
    const slice = html.slice(header.index, end);
    const count = Number(/<span class="num text-\[10px\] text-muted">(\d+)<\/span>/.exec(slice)?.[1] ?? NaN);
    return {
      category: header.category,
      count,
      items: cards
        .filter((c) => c.index > header.index && c.index < end)
        .map(({ id, name, href }) => ({ id, name, href })),
    };
  });
}

async function fetchPage(base: string, cookie: string) {
  const res = await fetch(`${base}/affiliate`, { headers: { cookie }, redirect: "manual" });
  assert.equal(res.status, 200, `GET /affiliate ha risposto ${res.status}`);
  const html = await res.text();
  assert.match(res.headers.get("content-type") ?? "", /text\/html/, "la pagina deve essere HTML");
  return { res, html, groups: parseAffiliate(html) };
}

const ids = (groups: Group[]) => groups.map((g) => g.category);
const flatIds = (groups: Group[]) => groups.flatMap((g) => g.items.map((i) => i.id));

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

function tempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `gm-e2e-${prefix}-`));
}

/**
 * The referrals table exactly as it shipped before `category` existed. Opening
 * this file through the app is what an operator upgrading from an older release
 * does, so it exercises the real migration, not a simulated one.
 */
const LEGACY_REFERRALS_SQL = `
CREATE TABLE referrals (
  id           TEXT PRIMARY KEY,
  platform     TEXT NOT NULL,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  tagline      TEXT,
  description  TEXT,
  how_it_works TEXT,
  tutorial     TEXT,
  terms        TEXT,
  rewards      TEXT,
  verified     INTEGER NOT NULL DEFAULT 0,
  affiliate_confirmed INTEGER NOT NULL DEFAULT 0,
  accent       TEXT DEFAULT 'gold',
  active       INTEGER NOT NULL DEFAULT 1,
  sort         INTEGER NOT NULL DEFAULT 100,
  updated_at   TEXT NOT NULL
);
`;

type LegacyRow = {
  id: string;
  platform: string;
  name: string;
  url: string;
  active: number;
  sort: number;
};

const LEGACY_ROWS: LegacyRow[] = [
  // A seeded id that predates categories: its category must come from config.
  { id: "kraken", platform: "Kraken", name: "Kraken Pro (legacy)", url: "https://invite.kraken.com/JDNW/legacy-test", active: 1, sort: 30 },
  // Owner data that config does not know: nothing may be dropped or rewritten.
  { id: "legacy-b", platform: "Legacy B", name: "Offerta B", url: "https://legacy.example/b", active: 1, sort: 200 },
  { id: "legacy-a", platform: "Legacy A", name: "Offerta A", url: "https://legacy.example/a", active: 1, sort: 200 },
  // Switched off on purpose: it must never come back with the migration or the seed.
  { id: "legacy-off", platform: "Legacy Off", name: "Offerta spenta", url: "https://legacy.example/off", active: 0, sort: 5 },
];

function writeLegacyDb(file: string) {
  const db = new DatabaseSync(file);
  db.exec(LEGACY_REFERRALS_SQL);
  const insert = db.prepare(
    `INSERT INTO referrals(id, platform, name, url, tagline, description, how_it_works, tutorial, terms, rewards, verified, affiliate_confirmed, accent, active, sort, updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const row of LEGACY_ROWS) {
    insert.run(row.id, row.platform, row.name, row.url, null, null, null, "[]", null, null, 0, 0, "gold", row.active, row.sort, "2026-01-01T00:00:00.000Z");
  }
  db.close();
}

/* -------------------------------------------------------------------------- */
/* A brand-new database                                                       */
/* -------------------------------------------------------------------------- */

test("a fresh database renders the catalogue grouped and ordered by category", { timeout: 180_000 }, async (t) => {
  const dir = tempDir("fresh");
  const server = await startServer(path.join(dir, "gm.db"), dir);
  t.after(async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const cookie = await signIn(server.base, ADMIN_EMAIL, ADMIN_PASSWORD);
  const { html, groups } = await fetchPage(server.base, cookie);

  // The canonical order is config's, not the order rows happen to be stored in.
  const expected = REFERRAL_CATEGORIES.map((category) => ({
    category,
    ids: REFERRALS.filter((r) => r.category === category).map((r) => r.id),
  })).filter((g) => g.ids.length > 0);

  assert.deepEqual(ids(groups), expected.map((g) => g.category), "le categorie devono seguire l'ordine canonico");
  assert.deepEqual(
    groups.map((g) => g.items.map((i) => i.id)),
    expected.map((g) => g.ids),
    "dentro un gruppo l'ordine deve essere per sort, poi piattaforma e nome",
  );

  for (const group of groups) {
    assert.equal(group.count, group.items.length, `il contatore di "${group.category}" non corrisponde alle card`);
    for (const card of group.items) {
      const config = REFERRALS.find((r) => r.id === card.id);
      assert.ok(config, `id ${card.id} non presente nel catalogo`);
      assert.equal(card.href, config.url, `la card ${card.id} deve puntare al proprio link`);
      assert.equal(card.name, config.name);
    }
  }

  // Every offer rendered exactly once, with a usable and unique id.
  const all = flatIds(groups);
  assert.equal(all.length, REFERRALS.length, "tutte e sole le offerte attive devono comparire");
  assert.equal(new Set(all).size, all.length, "gli id delle card devono essere univoci");
  for (const id of all) assert.ok(id.trim().length > 0, "nessun id vuoto");
  assert.equal((html.match(/data-referral-id=/g) ?? []).length, REFERRALS.length, "una sola CTA per offerta");

  // The signed-in administrator gets the shortcut to the panel.
  assert.match(html, /Gestisci referral/, "l'admin deve vedere il collegamento al pannello");
});

test("the page follows the admin panel: a new sort reorders the group", { timeout: 180_000 }, async (t) => {
  const dir = tempDir("order");
  const server = await startServer(path.join(dir, "gm.db"), dir);
  t.after(async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const cookie = await signIn(server.base, ADMIN_EMAIL, ADMIN_PASSWORD);
  const before = await fetchPage(server.base, cookie);
  assert.deepEqual(
    before.groups.find((g) => g.category === "Finanza / Exchange")?.items.map((i) => i.id),
    ["kraken", "coinbase"],
  );

  // Coinbase currently sorts after Kraken; the owner moves it to the top.
  const res = await fetch(`${server.base}/api/admin`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ action: "upsert_referral", id: "coinbase", sort: 1 }),
  });
  assert.equal(res.status, 200, await res.text());

  const after = await fetchPage(server.base, cookie);
  assert.deepEqual(
    after.groups.find((g) => g.category === "Finanza / Exchange")?.items.map((i) => i.id),
    ["coinbase", "kraken"],
    "la pagina deve riflettere subito il nuovo ordinamento",
  );

  // A partial update must not resurrect or drop anything else.
  assert.deepEqual(ids(after.groups), ids(before.groups));
  assert.deepEqual(flatIds(after.groups).sort(), flatIds(before.groups).sort());
});

/* -------------------------------------------------------------------------- */
/* An upgraded database                                                       */
/* -------------------------------------------------------------------------- */

test("an upgraded database keeps the owner's offers and gains their category", { timeout: 180_000 }, async (t) => {
  const dir = tempDir("migrated");
  const dbFile = path.join(dir, "gm.db");
  writeLegacyDb(dbFile);
  const server = await startServer(dbFile, dir);
  t.after(async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const cookie = await signIn(server.base, ADMIN_EMAIL, ADMIN_PASSWORD);
  const { groups } = await fetchPage(server.base, cookie);

  // Canonical categories first, then the reserve bucket for rows config cannot classify.
  // A category without active offers is not rendered at all.
  const activeCategories = new Set<string>(REFERRALS.map((r) => r.category));
  assert.deepEqual(ids(groups), [
    ...REFERRAL_CATEGORIES.filter((category) => activeCategories.has(category)),
    REFERRAL_UNCLASSIFIED,
  ]);
  assert.equal(groups.at(-1)?.items.map((i) => i.id).length, 2, "le due offerte sconosciute finiscono nel bucket di riserva");
  assert.deepEqual(groups.at(-1)?.items.map((i) => i.name), ["Offerta A", "Offerta B"], "stesso sort: decide il nome della piattaforma");

  // The legacy row for a known id keeps the owner's data and gets config's category.
  const kraken = groups.find((g) => g.category === "Finanza / Exchange")?.items.find((i) => i.id === "kraken");
  assert.ok(kraken, "kraken deve stare nella categoria del catalogo, non in quella di riserva");
  assert.equal(kraken.href, "https://invite.kraken.com/JDNW/legacy-test", "il link esistente non deve essere sovrascritto dal seed");
  assert.equal(kraken.name, "Kraken Pro (legacy)");

  // A switched-off offer stays off: it must not appear on the public page.
  assert.ok(!flatIds(groups).includes("legacy-off"), "un'offerta spenta non deve comparire");
  assert.doesNotMatch(JSON.stringify(groups), /Offerta spenta/);

  // The admin API still sees everything, including the inactive row: the page filters, not the data.
  const admin = await fetch(`${server.base}/api/admin`, { headers: { cookie } });
  assert.equal(admin.status, 200);
  const payload = (await admin.json()) as { data: { referrals?: { id: string; active: number }[] } };
  const adminRows = payload.data.referrals ?? [];
  const adminIds = adminRows.map((r) => r.id);
  assert.ok(adminIds.includes("legacy-off"), "il pannello deve continuare a mostrare l'offerta spenta");
  assert.deepEqual(
    adminRows.filter((r) => r.active === 1).map((r) => r.id).sort(),
    flatIds(groups).sort(),
    "pagina e pannello devono leggere lo stesso catalogo",
  );
});

/* -------------------------------------------------------------------------- */
/* Access rules                                                               */
/* -------------------------------------------------------------------------- */

test("the page stays behind the session and hides the panel from clients", { timeout: 180_000 }, async (t) => {
  const dir = tempDir("auth");
  const server = await startServer(path.join(dir, "gm.db"), dir);
  t.after(async () => {
    await server.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const anonymous = await fetch(`${server.base}/affiliate`, { redirect: "manual" });
  assert.ok([302, 307].includes(anonymous.status), `atteso un redirect al login, ricevuto ${anonymous.status}`);
  assert.match(anonymous.headers.get("location") ?? "", /\/login/, "il redirect deve portare al login");
  assert.doesNotMatch(await anonymous.text(), /data-referral-id=/, "nessuna offerta deve trapelare senza sessione");

  const clientCookie = await signIn(server.base, DEMO_EMAIL, DEMO_PASSWORD);
  const client = await fetchPage(server.base, clientCookie);
  assert.ok(client.groups.length > 0, "il cliente deve vedere il catalogo");
  assert.doesNotMatch(client.html, /Gestisci referral/, "il cliente non deve vedere il collegamento al pannello");

  const denied = await fetch(`${server.base}/api/admin`, { headers: { cookie: clientCookie } });
  assert.equal(denied.status, 403, "le API amministrative devono restare chiuse al cliente");
});
