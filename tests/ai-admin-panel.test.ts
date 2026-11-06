/**
 * Admin AI panel tests.
 *
 * The panel has no browser test runner in this project, so the checks are split
 * in two: pure functions (status and safe response mapping) are exercised
 * directly, while the page and the client form are checked structurally — they
 * must keep requiring an admin session, send only the three contract fields and
 * never persist or auto-send a prompt.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildPanelStatus, panelResultFrom } from "../src/lib/ai/panel";

const ROOT = process.cwd();
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("panel: status is disabled, active or quota and never claims requests", () => {
  const disabled = buildPanelStatus({
    enabled: false,
    reason: "adapter disattivato: GM_AI_OPENROUTER non è 'true'",
    used: 0,
    limit: 20,
    sharedDb: false,
    production: false,
  });
  assert.equal(disabled.state, "disabled");
  assert.equal(disabled.dailyLimit, 20);
  assert.equal(disabled.remaining, 20);
  assert.ok(disabled.warnings.some((warning) => warning.includes("GM_AI_OPENROUTER")));
  assert.ok(disabled.warnings.some((warning) => warning.includes("GM_AI_SHARED_DB")));

  const active = buildPanelStatus({
    enabled: true,
    reason: "OpenRouter attivo",
    used: 3,
    limit: 20,
    sharedDb: true,
    production: true,
    providerId: "openrouter",
    modelId: "cohere/north-mini-code:free",
  });
  assert.equal(active.state, "active");
  assert.equal(active.used, 3);
  assert.equal(active.remaining, 17);
  assert.equal(active.freeOnly, true);
  assert.equal(active.modelId, "cohere/north-mini-code:free");
  assert.deepEqual(active.warnings, []);

  const quota = buildPanelStatus({
    enabled: true,
    reason: "OpenRouter attivo",
    used: 20,
    limit: 20,
    sharedDb: true,
    production: false,
  });
  assert.equal(quota.state, "quota");
  assert.equal(quota.remaining, 0);

  // A corrupt counter cannot report negative usage or more than the limit.
  const corrupt = buildPanelStatus({
    enabled: true,
    reason: "",
    used: Number.NaN,
    limit: Number.NaN,
    sharedDb: true,
    production: false,
  });
  assert.equal(corrupt.used, 0);
  assert.equal(corrupt.dailyLimit, 20);
});

test("panel: a successful response exposes text and safe attempt metadata", () => {
  const outcome = panelResultFrom(200, {
    ok: true,
    providerId: "openrouter",
    modelId: "cohere/north-mini-code:free",
    text: "Risposta pubblica",
    attempts: [
      {
        providerId: "openrouter",
        modelId: "cohere/north-mini-code:free",
        version: "v",
        outcome: "ok",
        durationMs: 42,
        usage: { inputTokens: 10, outputTokens: 4 },
        detail: "must not surface",
      },
    ],
    error: "must not surface",
    detail: "must not surface",
  });
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;
  assert.equal(outcome.text, "Risposta pubblica");
  assert.equal(outcome.attempts.length, 1);
  assert.deepEqual(outcome.attempts[0].usage, { inputTokens: 10, outputTokens: 4 });
  assert.equal(JSON.stringify(outcome).includes("must not surface"), false);
});

test("panel: every HTTP error maps to a fixed message, never to provider detail", () => {
  const expected: Record<number, RegExp> = {
    400: /Richiesta non valida/,
    401: /Sessione scaduta/,
    403: /Permesso negato/,
    413: /Prompt troppo lungo/,
    422: /Nessun modello gratuito/,
    429: /Limite o budget esaurito/,
    502: /risposta non valida/,
    503: /AI non attiva/,
    504: /non ha risposto/,
  };

  for (const [status, pattern] of Object.entries(expected)) {
    const outcome = panelResultFrom(Number(status), {
      ok: false,
      code: "RATE_LIMITED",
      error: "sk-or-v1-segreto e stack trace",
      detail: "chiave interna",
    });
    assert.equal(outcome.ok, false);
    if (outcome.ok) continue;
    assert.match(outcome.message, pattern, `HTTP ${status}`);
    assert.equal(outcome.status, Number(status));
    assert.equal(JSON.stringify(outcome).includes("sk-or-v1"), false);
    assert.equal(JSON.stringify(outcome).includes("stack trace"), false);
  }

  const unknown = panelResultFrom(418, null);
  assert.equal(unknown.ok, false);
  if (!unknown.ok) assert.equal(unknown.message, "Richiesta non eseguita.");

  // A 200 that is not a valid completion is not shown as success.
  const invalid = panelResultFrom(200, { ok: true, text: "   " });
  assert.equal(invalid.ok, false);
  if (!invalid.ok) assert.equal(invalid.status, 502);
});

test("panel: the route requires an admin and the page is server-rendered only", () => {
  const page = read("src/app/(app)/admin/ai/page.tsx");
  assert.match(page, /requireAdmin\(/);
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.equal(/["']use client["']/.test(page), false);
  assert.equal(/OPENROUTER_API_KEY|sk-or-v1|process\.env\.GM_AI_OPENROUTER_MODEL/.test(page), false);
  assert.match(page, /getAiRuntime\(/);
  assert.match(page, /buildPanelStatus\(/);

  // The redirect is the actual denial path for an authenticated customer.
  const auth = read("src/lib/auth.ts");
  assert.match(auth, /user\.role !== "admin"\) redirect\("\/\?denied=admin"\)/);
});

test("panel: the client sends only the contract fields, never on mount", () => {
  const form = read("src/components/AiPanelForm.tsx");
  assert.match(form, /attestPublicData: true/);
  assert.match(form, /objective: objective\.trim\(\)/);
  assert.match(form, /prompt: prompt\.trim\(\)/);
  assert.equal((form.match(/fetch\(/g) ?? []).length, 1, "una sola fetch, dentro l'invio");
  assert.equal(/useEffect/.test(form), false, "nessun invio automatico al mount o a timer");
  assert.equal(/localStorage\.|sessionStorage\.|document\.cookie/.test(form), false, "nessuna persistenza nel browser");
  assert.equal(/console\.(log|warn|error|info|debug)/.test(form), false, "nessun prompt nei log");
  assert.match(form, /useState\(false\)/, "l'attestazione parte deselezionata");
  assert.match(form, /disabled=\{!canSend\}/);
  assert.match(form, /maxLength=\{MAX_PROMPT\}/);
});

test("panel: no engine, order or credential module is reachable from the panel", () => {
  const page = read("src/app/(app)/admin/ai/page.tsx");
  const form = read("src/components/AiPanelForm.tsx");
  const panel = read("src/lib/ai/panel.ts");
  for (const source of [page, form, panel]) {
    for (const forbidden of ["engine/", "lib/live", "lib/paper", "wallets", "credentials", "executeLiveOrder"]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} non deve entrare nel pannello AI`);
    }
  }
});
