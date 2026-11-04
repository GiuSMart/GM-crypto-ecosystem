import test, { mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/* -------------------------------------------------------------------------- */
/* Test runtime                                                                */
/* -------------------------------------------------------------------------- */

// The handlers open the real SQLite schema, so they get a throwaway database
// instead of the operator one. The env must be in place before src/lib/db runs.
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "gm-admin-route-"));
process.env.GM_DATA_DIR = runtimeDir;
process.env.GM_DB_PATH = path.join(runtimeDir, "route.db");
process.env.GM_ADMIN_PASSWORD = "Admin-Route-Test-a1!";
process.env.GM_DEMO_PASSWORD = "Demo-Route-Test-a1!";

/**
 * next/headers only resolves inside a live Next request. Mocking it keeps the
 * real handlers, sessions and SQL while feeding them the cookie and headers a
 * request would carry: the session token is the only thing a test sets.
 */
let sessionToken: string | null = null;
mock.module("next/headers", {
  exports: {
    cookies: async () => ({
      get: (name: string) => (sessionToken ? { name, value: sessionToken } : undefined),
    }),
    headers: async () =>
      new Headers({ host: "localhost:3000", "x-forwarded-for": "127.0.0.1", "user-agent": "node-test" }),
  },
});

// Loaded in a hook rather than at module scope: the mock has to be in place
// first, and tsx compiles these tests as CommonJS where top-level await is out.
let GET: (req: Request) => Promise<Response>;
let POST: (req: Request) => Promise<Response>;
let getDb: () => import("node:sqlite").DatabaseSync;
let createSession: (userId: string, ip: string | null, userAgent: string | null) => { token: string };
let REFERRAL_CATEGORIES: readonly string[];

test.before(async () => {
  ({ GET, POST } = await import("../src/app/api/admin/route"));
  ({ getDb } = await import("../src/lib/db"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ REFERRAL_CATEGORIES } = await import("../src/lib/config"));
});

test.after(() => {
  try {
    getDb().close();
  } catch {
    // already closed
  }
  fs.rmSync(runtimeDir, { recursive: true, force: true });
});

type ReferralRow = {
  id: string;
  platform: string;
  name: string;
  url: string;
  category: string;
  active: number;
  verified: number;
  affiliate_confirmed: number;
  sort: number;
  updated_at: string;
};

const db = () => getDb();
const call = (method: "GET" | "POST", body?: unknown) =>
  new Request("http://localhost:3000/api/admin", {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const payload = async (res: Response) => (await res.json()) as { ok: boolean; data?: unknown; error?: string };

/** Sign in as usr_admin or usr_demo, then put the token into the mocked cookie. */
async function signIn(role: "admin" | "client") {
  const token = createSession(role === "admin" ? "usr_admin" : "usr_demo", "127.0.0.1", "node-test").token;
  sessionToken = token;
}

const rowCount = () => (db().prepare("SELECT COUNT(*) AS n FROM referrals").get() as { n: number }).n;
const storedRow = (id: string) => (db().prepare("SELECT * FROM referrals WHERE id = ?").get(id) as ReferralRow | undefined) ?? null;

const newOffer = (overrides: Record<string, unknown> = {}) => {
  const id = typeof overrides.id === "string" ? overrides.id.trim() : "offer";
  return {
    action: "upsert_referral",
    platform: "Route Test",
    name: "Offerta di route",
    // One link per test id: the catalogue refuses duplicates across offers.
    url: `https://route-test.example/${id || "offer"}`,
    category: REFERRAL_CATEGORIES[0],
    ...overrides,
  };
};

/* -------------------------------------------------------------------------- */
/* GET /api/admin                                                              */
/* -------------------------------------------------------------------------- */

test("the catalogue is not readable without a session", async () => {
  sessionToken = null;
  const res = await GET(call("GET"));
  const body = await payload(res);

  assert.equal(res.status, 401);
  assert.equal(body.ok, false);
  assert.equal(body.error, "Autenticazione richiesta.");
  assert.equal(body.data, undefined, "nessun dato del catalogo deve uscire senza sessione");
});

test("a non-admin session is refused instead of served", async () => {
  await signIn("client");
  const res = await GET(call("GET"));
  const body = await payload(res);

  assert.equal(res.status, 403);
  assert.equal(body.error, "Permesso negato.");
  assert.equal(body.data, undefined);
});

test("the admin catalogue is uncached, complete and ordered by sort then name", async () => {
  await signIn("admin");
  const res = await GET(call("GET"));
  const body = await payload(res);

  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(res.headers.get("cache-control"), "no-store", "il catalogo non deve essere messo in cache");

  const referrals = (body.data as { referrals: ReferralRow[] }).referrals;
  assert.equal(referrals.length, rowCount(), "la risposta deve elencare tutte le offerte, spente comprese");

  for (const row of referrals) {
    assert.ok(row.id.trim().length > 0, "ogni offerta deve avere un id: i transfer script lo usano come chiave");
    assert.ok(row.url.startsWith("https://"), `URL non https per ${row.id}`);
    assert.equal(typeof row.active, "number");
    assert.equal(typeof row.verified, "number");
    assert.equal(typeof row.affiliate_confirmed, "number");
    assert.equal(typeof row.sort, "number");
  }

  assert.equal(new Set(referrals.map((r) => r.id)).size, referrals.length, "gli id devono essere unici");

  for (let i = 1; i < referrals.length; i += 1) {
    const previous = referrals[i - 1];
    const current = referrals[i];
    const ordered =
      previous.sort < current.sort || (previous.sort === current.sort && previous.name <= current.name);
    assert.ok(ordered, `${current.id} fuori ordine: ${previous.sort}/${previous.name} prima di ${current.sort}/${current.name}`);
  }
});

/* -------------------------------------------------------------------------- */
/* POST /api/admin — upsert_referral                                           */
/* -------------------------------------------------------------------------- */

test("an id arrives trimmed, so the stored key is the one the page renders", async () => {
  await signIn("admin");
  const res = await POST(call("POST", newOffer({ id: "   test-route-offer   " })));
  const body = await payload(res);

  assert.equal(res.status, 200);
  assert.deepEqual(body.data, { id: "test-route-offer" });

  const stored = storedRow("test-route-offer");
  assert.ok(stored, "la riga deve esistere con l'id ripulito");
  assert.equal(stored.active, 1, "una nuova offerta è attiva di default");

  const catalogue = (await payload(await GET(call("GET")))).data as { referrals: ReferralRow[] };
  assert.ok(catalogue.referrals.some((r) => r.id === "test-route-offer"));
});

test("a partial update never clears the flags or the link of the stored row", async () => {
  await signIn("admin");
  // Start from an offer that is switched off and verified, then rename it only.
  assert.equal((await POST(call("POST", newOffer({ id: "test-route-flag", active: false, verified: true })))).status, 200);

  const res = await POST(call("POST", { action: "upsert_referral", id: "test-route-flag", name: "Offerta rinominata" }));
  assert.equal(res.status, 200);

  const stored = storedRow("test-route-flag");
  assert.equal(stored?.name, "Offerta rinominata");
  assert.equal(stored?.active, 0, "una rinomina non deve riaccendere l'offerta");
  assert.equal(stored?.verified, 1, "una rinomina non deve perdere la verifica");
  assert.equal(stored?.url, "https://route-test.example/test-route-flag", "una rinomina non deve perdere il link");
});

test("a link already in the catalogue is rejected and no existing row is touched", async () => {
  await signIn("admin");
  assert.equal(
    (await POST(call("POST", newOffer({ id: "test-dup-source", name: "Sorgente", url: "https://route-test.example/dup" })))).status,
    200,
  );
  const before = rowCount();

  // The same link arriving with surrounding blanks: normalisation must still catch it.
  const res = await POST(
    call("POST", newOffer({ id: "test-dup-target", name: "Duplicato", url: "  https://route-test.example/dup  " })),
  );
  const body = await payload(res);

  assert.equal(res.status, 400);
  assert.match(body.error ?? "", /Link già presente/);
  assert.match(body.error ?? "", /Sorgente/, "l'errore deve dire quale offerta possiede il link");
  assert.equal(rowCount(), before, "il duplicato non deve creare righe");
  assert.equal(storedRow("test-dup-target"), null);
  assert.equal(storedRow("test-dup-source")?.url, "https://route-test.example/dup");
});

test("an invalid category is refused before anything is written", async () => {
  await signIn("admin");
  const res = await POST(call("POST", newOffer({ id: "test-bad-category", category: "Categoria inventata" })));
  const body = await payload(res);

  assert.equal(res.status, 400);
  assert.match(body.error ?? "", /Categoria non valida/);
  assert.equal(storedRow("test-bad-category"), null);
});

/* -------------------------------------------------------------------------- */
/* POST /api/admin — delete_referral and the guard rails                       */
/* -------------------------------------------------------------------------- */

test("delete_referral removes the offer from the catalogue read model", async () => {
  await signIn("admin");
  assert.equal((await POST(call("POST", newOffer({ id: "test-route-delete" })))).status, 200);

  const res = await POST(call("POST", { action: "delete_referral", id: "test-route-delete" }));
  assert.equal(res.status, 200);
  assert.equal(storedRow("test-route-delete"), null);

  const catalogue = (await payload(await GET(call("GET")))).data as { referrals: ReferralRow[] };
  assert.equal(catalogue.referrals.some((r) => r.id === "test-route-delete"), false);
});

test("mutations stay closed to anonymous and client sessions", async () => {
  sessionToken = null;
  const anonymous = await POST(call("POST", newOffer({ id: "test-anonymous-offer" })));
  assert.equal(anonymous.status, 401);

  await signIn("client");
  const client = await POST(call("POST", newOffer({ id: "test-client-offer" })));
  assert.equal(client.status, 403);

  assert.equal(storedRow("test-anonymous-offer"), null);
  assert.equal(storedRow("test-client-offer"), null);
});

test("a cross-site request is blocked even with a valid admin session", async () => {
  await signIn("admin");
  const foreign = await POST(
    new Request("http://localhost:3000/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify(newOffer({ id: "test-cross-site" })),
    }),
  );

  assert.equal(foreign.status, 403);
  assert.equal(storedRow("test-cross-site"), null);
});
