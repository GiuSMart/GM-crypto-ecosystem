#!/usr/bin/env node
/**
 * Rotate a GM Crypto Ecosystem account password without ever writing the
 * secret to disk, logs or shell history.
 *
 * What it does, in order:
 *   1. logs in with the current password;
 *   2. posts the new password to POST /api/auth/password;
 *   3. proves the rotation: a fresh login with the new password must succeed
 *      and the old password must now be rejected (401).
 *
 * The current password is read from --current-file when it exists (the bootstrap
 * file written on first boot) and otherwise prompted for. The new password is
 * always typed at a hidden prompt: it is never passed as an argument, because
 * arguments are visible in the process list and the shell history.
 *
 * Usage:
 *   node scripts/set-admin-password.mjs                      # admin account, local dev server
 *   node scripts/set-admin-password.mjs --base https://app.example.com --email me@example.com
 *
 * Options:
 *   --base <url>            default http://127.0.0.1:3001
 *                           http è accettato solo su localhost, 127.0.0.1 e ::1;
 *                           ogni altro host richiede https e una URL senza
 *                           credenziali, query, fragment o percorso
 *   --email <address>       default: first admin row in the local database
 *   --current-file <path>   default data/.bootstrap-admin (removed after success)
 *   --keep-bootstrap-file   do not delete the current-file after success
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { dataDir, dbFile } from "./lib/runtime-paths.mjs";
import { resolveBaseUrl } from "./lib/transfer-safety.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const DATA_DIR = dataDir();
const DB_FILE = dbFile();
const CURRENT_FILE = opt("current-file", path.join(DATA_DIR, ".bootstrap-admin"));
const KEEP_FILE = flag("keep-bootstrap-file");

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

// Refuse a bad target before the current password is even read from disk.
let BASE;
try {
  BASE = resolveBaseUrl(opt("base", "http://127.0.0.1:3001"));
} catch (err) {
  fail(`base URL rifiutata: ${err.message}`);
}
const ok = (msg) => console.log(`✓ ${msg}`);

/**
 * Line reader for non-interactive runs (CI, scripted checks). Piped input is not
 * echoed; buffered leftovers are kept so several prompts can share one pipe.
 */
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
  process.stdin.on("data", (chunk) => {
    piped += chunk;
    flushPiped();
  });
  process.stdin.on("end", () => {
    if (pendingLine && piped.length) {
      const resolve = pendingLine;
      pendingLine = null;
      resolve(piped.trim());
      piped = "";
    }
  });
}

/** Hidden password prompt: no echo, Ctrl+C aborts. */
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

/** Local-only helper: find an admin address so the operator need not retype it. */
function firstAdminFromLocalDb() {
  try {
    if (!fs.existsSync(DB_FILE)) return null;
    const db = new DatabaseSync(DB_FILE, { readOnly: true });
    const row = db.prepare("SELECT email FROM users WHERE role = 'admin' ORDER BY created_at ASC").get();
    db.close();
    return row?.email ?? null;
  } catch {
    return null;
  }
}

function passwordProblems(password) {
  const problems = [];
  if (password.length < 10) problems.push("almeno 10 caratteri");
  if (!/[a-z]/.test(password)) problems.push("una minuscola");
  if (!/[A-Z]/.test(password)) problems.push("una maiuscola");
  if (!/[0-9]/.test(password)) problems.push("un numero");
  return problems;
}

function cookieFrom(res) {
  const list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const raw = list[0] ?? res.headers.get("set-cookie") ?? "";
  return raw.split(";")[0];
}

async function post(urlPath, body, cookie) {
  const headers = { "Content-Type": "application/json", Origin: BASE };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${urlPath}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "manual",
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON error body */
  }
  return { status: res.status, json, cookie: cookieFrom(res) };
}

const email = opt("email") ?? firstAdminFromLocalDb() ?? fail("email non indicata e nessun admin trovato in " + DB_FILE);
console.log(`account: ${email}`);
console.log(`server:  ${BASE}`);

// 1. Current password: prefer the bootstrap file so it never appears on screen.
let current = null;
if (fs.existsSync(CURRENT_FILE)) {
  current = fs.readFileSync(CURRENT_FILE, "utf8").trim();
  console.log(`password attuale: letta da ${CURRENT_FILE}`);
} else {
  current = await askHidden("Password attuale: ");
}
if (!current) fail("password attuale vuota");

// 2. New password, typed twice and never echoed.
const next = await askHidden("Nuova password: ");
const problems = passwordProblems(next);
if (problems.length) fail(`la nuova password deve contenere ${problems.join(", ")}`);
if (next === current) fail("la nuova password deve essere diversa da quella attuale");
const confirm = await askHidden("Ripeti la nuova password: ");
if (confirm !== next) fail("le due password non coincidono");

// 3. Log in, rotate, then prove both directions of the change.
const login = await post("/api/auth/login", { email, password: current });
if (login.status !== 200 || !login.json?.ok) fail(`login con la password attuale fallito (HTTP ${login.status})`);

const changed = await post("/api/auth/password", { current, next }, login.cookie);
if (changed.status !== 200 || !changed.json?.ok) {
  fail(`cambio password rifiutato (HTTP ${changed.status}): ${changed.json?.error ?? "errore sconosciuto"}`);
}
ok("password aggiornata dal server");

const newLogin = await post("/api/auth/login", { email, password: next });
if (newLogin.status !== 200 || !newLogin.json?.ok) fail(`il login con la nuova password NON funziona (HTTP ${newLogin.status})`);
ok("login con la nuova password: riuscito");

const oldLogin = await post("/api/auth/login", { email, password: current });
if (oldLogin.status === 200 && oldLogin.json?.ok) fail("la vecchia password funziona ancora: rotazione incompleta");
ok(`vecchia password respinta (HTTP ${oldLogin.status})`);

if (newLogin.json?.data?.mustChangePassword === true) {
  console.log("! il server segnala ancora mustChangePassword: controlla la risposta");
} else {
  ok("mustChangePassword azzerato");
}

if (fs.existsSync(CURRENT_FILE) && !KEEP_FILE) {
  fs.rmSync(CURRENT_FILE);
  ok(`${CURRENT_FILE} rimosso: la password non resta in chiaro nel workspace`);
}

console.log("");
console.log("Fatto. Le altre sessioni aperte sono state revocate: chiudi le vecchie schede e rientra.");
