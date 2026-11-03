#!/usr/bin/env node
/**
 * Move the Affiliate Center catalogue between environments without duplicates
 * and without touching anything else in the database.
 *
 * Why not copy data/gm.db: that file also holds users, sessions, exchange
 * credentials and the audit log. Copying it to production would overwrite the
 * accounts of the target environment. The referral catalogue is operator data,
 * so it travels through the admin API (POST /api/admin, action upsert_referral),
 * which is the same path the panel uses and which already rejects duplicate
 * links and non-https URLs.
 *
 * Commands:
 *   export  [--out data/referrals-export.json]
 *   import  --in <file> [--base <url>] [--apply]     (dry run unless --apply)
 *   verify  --in <file> [--base <url>]
 *
 * Guarantees:
 *   - idempotent: rows carry their id, and upsert_referral is ON CONFLICT(id),
 *     so re-running the import updates instead of creating a second copy;
 *   - non-destructive: nothing is ever deleted, and rows absent from the target
 *     are simply left alone;
 *   - checked: every row is compared with the stored catalogue (id, link) and
 *     with the rendered /affiliate page, which must list exactly the active
 *     offers and none of the disabled ones.
 *
 * Credentials: email from --email or GM_ADMIN_EMAIL, password from a hidden
 * prompt. Nothing is written to disk.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { dbFile } from "./lib/runtime-paths.mjs";
import { compareSnapshot, normaliseUrl, referralAdminBody, resolveBaseUrl, storedFor } from "./lib/transfer-safety.mjs";

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);
const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

// Where to send an admin password is decided once, before anything is read from
// disk, so a mistyped or hostile --base stops here instead of leaking a session.
let BASE;
try {
  BASE = resolveBaseUrl(opt("base", "http://127.0.0.1:3001"));
} catch (err) {
  die(`base URL rifiutata: ${err.message}`);
}
const EMAIL = opt("email", process.env.GM_ADMIN_EMAIL ?? null);

const norm = normaliseUrl;

/* ------------------------------------------------------------------ */
/* Catalogue I/O                                                       */
/* ------------------------------------------------------------------ */

/** Fields the admin API accepts, mapped from the column names. */
const TO_API = {
  id: "id",
  platform: "platform",
  name: "name",
  category: "category",
  url: "url",
  tagline: "tagline",
  description: "description",
  how_it_works: "howItWorks",
  terms: "terms",
  rewards: "rewards",
  accent: "accent",
  sort: "sort",
};

function exportCatalogue(out) {
  const file = dbFile();
  if (!fs.existsSync(file)) die(file + " non esiste: esporta dall’ambiente che contiene le offerte");
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare("SELECT * FROM referrals ORDER BY sort ASC, name ASC").all();
  db.close();
  if (!rows.length) die("nessuna offerta da esportare");
  const payload = {
    exportedAt: new Date().toISOString(),
    count: rows.length,
    referrals: rows.map((r) => ({
      ...Object.fromEntries(Object.entries(TO_API).map(([col]) => [col, r[col] ?? null])),
      url: norm(r.url),
      tutorial: safeJsonArray(r.tutorial),
      verified: r.verified === 1,
      affiliateConfirmed: r.affiliate_confirmed === 1,
      active: r.active === 1,
    })),
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  console.log(`✓ esportate ${payload.count} offerte in ${out}`);
  for (const r of payload.referrals) console.log(`   ${rowTag(r).padEnd(26)} ${r.category}`);
  return payload;
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Label used in the console output. The id is optional in a hand-written
 * snapshot (the API creates a fresh one), so it can never be dereferenced here:
 * a missing id used to throw halfway through an import, after some rows had
 * already been written.
 */
function rowTag(row) {
  return typeof row?.id === "string" && row.id ? row.id : "(senza id)";
}

function loadSnapshot(file) {
  if (!file) die("serve --in <file>");
  if (!fs.existsSync(file)) die(`${file} non trovato`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = Array.isArray(data) ? data : data.referrals;
  if (!Array.isArray(rows) || rows.length === 0) die("snapshot vuoto: niente da importare");
  // Rows are read from a file, so they are checked before anything is labelled
  // or posted: a malformed entry must fail here, not halfway through an import.
  return rows.map((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) die(`riga ${i + 1} non valida: atteso un oggetto`);
    if (typeof row.url !== "string" || !row.url.trim()) die(`riga ${i + 1} senza url`);
    if (typeof row.name !== "string" || !row.name.trim()) die(`riga ${i + 1} senza nome`);
    if (row.id !== undefined && row.id !== null && typeof row.id !== "string") die(`riga ${i + 1}: id non testuale`);
    // A blank id is not an id: it would be sent to the API and turned into a
    // referral whose primary key is whitespace.
    const id = typeof row.id === "string" ? row.id.trim() : "";
    return id ? { ...row, id } : { ...row, id: undefined };
  });
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

let piped = "";
let pendingLine = null;
function flushPiped() {
  if (!pendingLine) return;
  const nl = piped.indexOf("\n");
  if (nl === -1) return;
  const line = piped.slice(0, nl).replace(/\r$/, "");
  piped = piped.slice(nl + 1);
  const resolve = pendingLine;
  pendingLine = null;
  resolve(line);
}
if (!process.stdin.isTTY) {
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", (c) => {
    piped += c;
    flushPiped();
  });
}

function askHidden(question) {
  if (!process.stdin.isTTY) {
    process.stdout.write(`${question}(da stdin)\n`);
    return new Promise((resolve) => {
      pendingLine = resolve;
      flushPiped();
    });
  }
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    let buffer = "";
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.removeListener("data", onData);
          process.stdout.write("\n");
          resolve(buffer);
          return;
        }
        if (ch === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === "\u007f" || ch === "\b") buffer = buffer.slice(0, -1);
        else buffer += ch;
      }
    };
    stdin.on("data", onData);
  });
}

async function login() {
  if (!EMAIL) die("serve --email (o GM_ADMIN_EMAIL) per autenticarsi sull'ambiente di destinazione");
  const password = await askHidden(`Password per ${EMAIL}: `);
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: EMAIL, password }),
    redirect: "manual",
  });
  if (res.status !== 200) die(`login fallito su ${BASE} (HTTP ${res.status})`);
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie = (cookies[0] ?? res.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) die("il server non ha restituito un cookie di sessione");
  return cookie;
}

async function adminPost(cookie, body) {
  const res = await fetch(`${BASE}/api/admin`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: BASE, Cookie: cookie },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* body non JSON */
  }
  return { status: res.status, json };
}

/**
 * Catalogue as stored on the destination, read from the admin read model.
 *
 * The public page cannot be the source of truth for a verification: it never
 * renders a disabled offer, so a correctly imported inactive row looked like a
 * missing one, and a link could match another row's href.
 */
async function adminCatalogue(cookie) {
  const res = await fetch(`${BASE}/api/admin`, { headers: { Cookie: cookie }, redirect: "manual" });
  if (res.status === 401 || res.status === 403) {
    die(`/api/admin ha risposto ${res.status}: ${EMAIL ?? "questo utente"} non è admin su ${BASE}`);
  }
  if (res.status !== 200) die(`/api/admin ha risposto ${res.status}: impossibile leggere il catalogo di destinazione`);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* body non JSON */
  }
  const referrals = json?.data?.referrals;
  if (!json?.ok || !Array.isArray(referrals)) die("risposta inattesa da /api/admin: manca l'elenco delle offerte");
  return referrals;
}

/** Decode the entities React emits inside quoted HTML attributes. */
function decodeHtmlAttribute(value) {
  const entities = {
    "&amp;": "&",
    "&quot;": '"',
    "&#x27;": "'",
    "&#39;": "'",
    "&lt;": "<",
    "&gt;": ">",
    "&#x2F;": "/",
    "&#x2f;": "/",
  };
  return value.replace(/&(?:amp|quot|lt|gt|#x2f|#x27|#39);/gi, (entity) => entities[entity] ?? entity);
}

/**
 * Reads only the actual referral anchors. The explicit data-referral-id is
 * paired with that same anchor's href, so another page link or another offer
 * using the same URL cannot satisfy this row's visibility check.
 */
async function publishedReferrals(cookie) {
  const res = await fetch(`${BASE}/affiliate`, { headers: { Cookie: cookie }, redirect: "manual" });
  if (res.status !== 200) die(`/affiliate ha risposto ${res.status}: sessione non valida o gate attivo`);
  const html = await res.text();
  const referrals = new Map();
  const anchors = /<a\b(?=[^>]*\bdata-referral-id="([^"]+)")(?=[^>]*\bhref="([^"]+)")[^>]*>/gi;
  for (const match of html.matchAll(anchors)) {
    const id = decodeHtmlAttribute(match[1]);
    const url = norm(decodeHtmlAttribute(match[2]));
    if (id) referrals.set(id, url);
  }
  return referrals;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

const command = cmd ?? "export";

/** Prints one line per snapshot row plus a summary; the caller decides the exit code. */
function printReport(report, title) {
  console.log(
    `\n${title}: ${report.public}/${report.total} pubblicate, ${report.inactive} disattivate (attese, non in pagina)`,
  );
  for (const r of report.results) {
    const mark = r.status === "pubblicata" ? "✓" : r.status === "spenta" ? "·" : "✗";
    console.log(`   ${mark} ${rowTag({ id: r.id }).padEnd(26)} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  if (!report.problems.length) console.log("\n✓ catalogo e pagina coerenti con lo snapshot");
}

if (command === "export") {
  exportCatalogue(opt("out", path.join("data", "referrals-export.json")));
} else if (command === "import" || command === "verify") {
  const rows = loadSnapshot(opt("in"));
  const apply = command === "import" && has("apply");
  const cookie = await login();
  const before = await adminCatalogue(cookie);
  const live = await publishedReferrals(cookie);

  if (command === "verify") {
    const report = compareSnapshot(rows, before, live);
    printReport(report, BASE);
    process.exit(report.problems.length ? 1 : 0);
  }

  console.log(`\n${apply ? "IMPORTAZIONE" : "SIMULAZIONE (aggiungi --apply per scrivere)"} → ${BASE}`);
  console.log(`offerte nello snapshot: ${rows.length}\n`);

  let created = 0;
  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    // Identity comes from the stored catalogue, not from the rendered page: a
    // disabled offer is absent from the page, so it used to look new.
    const stored = storedFor(before, row);
    const label = stored ? "aggiorna" : "nuova   ";
    // The body is rebuilt from an allowlist, so a stray "action" (or any other
    // field) in the snapshot file can never reach the admin API. Building it in
    // the dry run too means a malformed row is reported before anything writes.
    let body;
    try {
      // A snapshot written by hand may omit the id; the stored one is reused so
      // the row is updated instead of being refused as a duplicate link.
      body = referralAdminBody(stored && !row.id ? { ...row, id: stored.id } : row);
    } catch (err) {
      failed++;
      console.log(`   ✗ ${label} ${rowTag(row).padEnd(18)} ${err.message}`);
      continue;
    }
    if (!apply) {
      console.log(`   [dry-run] ${label} ${rowTag(row).padEnd(26)} ${row.name}`);
      continue;
    }
    const { status, json } = await adminPost(cookie, body);
    if (status === 200 && json?.ok) {
      if (stored) updated++;
      else created++;
      // The API chooses the id of a new row: keeping it in the row means the
      // report below prints the id that now exists instead of "(senza id)".
      if (!row.id && typeof json?.data?.id === "string") row.id = json.data.id;
      console.log(`   ✓ ${label} ${rowTag(row).padEnd(26)} ${row.name}`);
    } else {
      failed++;
      console.log(`   ✗ ${label} ${rowTag(row).padEnd(26)} ${json?.error ?? `HTTP ${status}`}`);
    }
  }

  if (!apply) {
    console.log(`\nNessuna scrittura eseguita. Riesegui con --apply per applicare le ${rows.length} offerte.`);
    process.exit(failed ? 1 : 0);
  }

  console.log(`\ncreate: ${created} | aggiornate: ${updated} | rifiutate: ${failed}`);
  const report = compareSnapshot(rows, await adminCatalogue(cookie), await publishedReferrals(cookie));
  printReport(report, "verifica dopo l'import");
  process.exit(report.problems.length || failed ? 1 : 0);
} else {
  die(`comando sconosciuto: ${command} (usa export, import o verify)`);
}
