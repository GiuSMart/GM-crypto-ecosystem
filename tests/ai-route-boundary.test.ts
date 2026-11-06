/**
 * Static boundary checks for the AI HTTP entry point. They are structural on
 * purpose: they must fail if someone later weakens the route, moves it to the
 * Edge runtime, lets a client choose the classification, or imports it from a
 * Client Component.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

function walk(dir: string): string[] {
  const entries = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(relative));
    else files.push(relative);
  }
  return files;
}

test("the AI route is admin-only, Node runtime and POST only", () => {
  const route = read("src/app/api/ai/route.ts");
  assert.match(route, /export const runtime = "nodejs"/);
  assert.match(route, /adminOnly:\s*true/);
  assert.match(route, /export async function POST/);
  assert.equal(/export async function (GET|PUT|PATCH|DELETE)/.test(route), false);
  assert.equal(/"use client"/.test(route), false);
  assert.equal(/OPENROUTER_API_KEY/.test(route), false, "la route non deve leggere la chiave");
  assert.equal(/process\.env/.test(route), false, "la configurazione resta nel runtime");
  for (const forbidden of ["lib/live", "lib/paper", "engine/", "wallets", "credentials", "venues"]) {
    assert.equal(route.includes(forbidden), false, `${forbidden} non deve entrare nella route AI`);
  }
});

test("classification, budget and provider are chosen by the server", () => {
  const http = read("src/lib/ai/http.ts");
  assert.match(http, /dataClass: "PUBLIC"/);
  assert.match(http, /SERVER_OWNED_FIELDS/);
  assert.equal(/body\.dataClass|body\["dataClass"\]/.test(http), false);
  assert.equal(/dataClass:\s*[A-Za-z_$]/.test(http.replace(/dataClass: "PUBLIC"/, "")), false);
});

test("no client component imports the AI runtime, the route or the parser", () => {
  const files = walk("src").filter((file) => /\.(ts|tsx|js|jsx)$/.test(file));
  const clients = files.filter((file) => /^\s*["']use client["']/m.test(read(file)));
  assert.ok(clients.length > 0, "il progetto deve avere componenti client da controllare");
  for (const file of clients) {
    const source = read(file);
    assert.equal(
      /(lib\/ai\/runtime|ai\/runtime|api\/ai\/route|lib\/ai\/http)/.test(source),
      false,
      `${file} non deve importare moduli server-only dell'AI`,
    );
  }
});

test("the runtime declares an explicit server-only boundary", () => {
  const runtime = read("src/lib/ai/runtime.ts");
  assert.match(runtime, /typeof window !== "undefined"/);
  assert.match(runtime, /server-only/);
  assert.match(runtime, /GET_|getAiRuntime/);
});

test("the route cannot be reached without authentication and same-origin checks", () => {
  const route = read("src/app/api/ai/route.ts");
  assert.match(route, /guardedMutation\(/);
  assert.match(route, /if \(guard\.error\) return guard\.error/);
  assert.equal(/jsonOk\(|jsonError\("ok"/.test(route), false);
  assert.match(route, /no-store/);
});
