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
 *   - checked: every row is verified on the rendered /affiliate page afterwards.
 *
 * Credentials: email from --email or GM_ADMIN_EMAIL, password from a hidden
 * prompt. Nothing is written to disk.
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { normaliseUrl, referralAdminBody, resolveBaseUrl } from "./lib/transfer-safety.mjs";

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
  const dbFile = path.join("data", "gm.db");
  if (!fs.existsSync(dbFile)) die(`${dbFile} non esiste: esporta dall'ambiente che contiene le offerte`);
  const db = new DatabaseSync(dbFile, { readOnly: true });
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
  for (const r of payload.referrals) console.log(`   ${r.id.padEnd(26)} ${r.category}`);
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

function loadSnapshot(file) {
  if (!file) die("serve --in <file>");
  if (!fs.existsSync(file)) die(`${file} non trovato`);
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const rows = Array.isArray(data) ? data : data.referrals;
  if (!Array.isArray(rows) || rows.length === 0) die("snapshot vuoto: niente da importare");
  // Rows are read from a file, so they are checked before anything is labelled
  // or posted: a malformed entry must fail here, not halfway through an import.
  rows.forEach((row, i) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) die(`riga ${i + 1} non valida: atteso un oggetto`);
    if (typeof row.url !== "string" || !row.url.trim()) die(`riga ${i + 1} senza url`);
    if (typeof row.name !== "string" || !row.name.trim()) die(`riga ${i + 1} senza nome`);
    if (row.id !== undefined && typeof row.id !== "string") die(`riga ${i + 1}: id non testuale`);
  });
  return rows;
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

/** Reads the rendered catalogue page, which is what a visitor actually gets. */
async function publishedUrls(cookie) {
  const res = await fetch(`${BASE}/affiliate`, { headers: { Cookie: cookie }, redirect: "manual" });
  if (res.status !== 200) die(`/affiliate ha risposto ${res.status}: sessione non valida o gate attivo`);
  const html = await res.text();
  // React escapes `&` in attributes as `&amp;`, so unescape before comparing:
  // referral URLs are full of query separators and would never match otherwise.
  return new Set(
    [...html.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => norm(m[1].replace(/&amp;/g, "&").replace(/&#x2F;/g, "/"))),
  );
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

const command = cmd ?? "export";

if (command === "export") {
  exportCatalogue(opt("out", path.join("data", "referrals-export.json")));
} else if (command === "import") {
  const rows = loadSnapshot(opt("in"));
  const apply = has("apply");
  const cookie = await login();
  const live = await publishedUrls(cookie);

  console.log(`\n${apply ? "IMPORTAZIONE" : "SIMULAZIONE (aggiungi --apply per scrivere)"} → ${BASE}`);
  console.log(`offerte nello snapshot: ${rows.length}\n`);

  let created = 0;
  let updated = 0;
  let failed = 0;
  for (const row of rows) {
    const existsAlready = live.has(norm(row.url));
    const label = existsAlready ? "aggiorna" : "nuova   ";
    // The body is rebuilt from an allowlist, so a stray "action" (or any other
    // field) in the snapshot file can never reach the admin API. Building it in
    // the dry run too means a malformed row is reported before anything writes.
    let body;
    try {
      body = referralAdminBody(row);
    } catch (err) {
      failed++;
      console.log(`   ✗ ${label} ${String(row?.id ?? "?").padEnd(18)} ${err.message}`);
      continue;
    }
    if (!apply) {
      console.log(`   [dry-run] ${label} ${row.id.padEnd(26)} ${row.name}`);
      continue;
    }
    const { status, json } = await adminPost(cookie, body);
    if (status === 200 && json?.ok) {
      if (existsAlready) updated++;
      else created++;
      console.log(`   ✓ ${label} ${row.id.padEnd(26)} ${row.name}`);
    } else {
      failed++;
      console.log(`   ✗ ${label} ${row.id.padEnd(26)} ${json?.error ?? `HTTP ${status}`}`);
    }
  }

  if (!apply) {
    console.log(`\nNessuna scrittura eseguita. Riesegui con --apply per applicare le ${rows.length} offerte.`);
  } else {
    console.log(`\ncreate: ${created} | aggiornate: ${updated} | rifiutate: ${failed}`);
    const after = await publishedUrls(cookie);
    const missing = rows.filter((r) => !after.has(norm(r.url)));
    console.log(`verifica su /affiliate: ${rows.length - missing.length}/${rows.length} link pubblicati`);
    if (missing.length) {
      console.log("non trovati in pagina:");
      for (const m of missing) console.log(`   · ${m.id} (${m.url})`);
      process.exit(1);
    }
    console.log("✓ tutte le offerte dello snapshot sono raggiungibili dalla pagina Affiliate");
  }
} else if (command === "verify") {
  const rows = loadSnapshot(opt("in"));
  const cookie = await login();
  const live = await publishedUrls(cookie);
  const present = rows.filter((r) => live.has(norm(r.url)));
  console.log(`\n${BASE} → ${present.length}/${rows.length} offerte dello snapshot sono pubblicate`);
  for (const r of rows) console.log(`   ${live.has(norm(r.url)) ? "✓" : "·"} ${r.id.padEnd(26)} ${r.name}`);
  if (present.length !== rows.length) process.exit(1);
} else {
  die(`comando sconosciuto: ${command} (usa export, import o verify)`);
}
