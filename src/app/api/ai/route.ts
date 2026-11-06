/**
 * Server-only entry point for the free-only AI Collective.
 *
 * Security decisions, all deliberate:
 * - admin only: a prompt leaves the host, so a tenant client cannot trigger it;
 * - session cookie + same-origin check via the existing `guardedMutation`;
 * - the data classification is forced to PUBLIC by `parseAiRequest`, never read
 *   from the body, so INTERNAL/CONFIDENTIAL/SECRET work cannot reach a hosted
 *   free model;
 * - one provider attempt per request and a per-account daily budget, both
 *   persisted, so a single account cannot drain the 50/day free quota;
 * - no key, no provider detail and no internal error text is returned.
 *
 * The gateway additionally enforces a shared 18 req/minute window in SQLite, so
 * several processes behind the same account cannot each allow 18.
 */
import { NextResponse } from "next/server";
import { guardedMutation, jsonError } from "@/lib/api";
import { newId } from "@/lib/crypto";
import { getAiRuntime } from "@/lib/ai/runtime";
import { parseAiRequest, toAiResponse } from "@/lib/ai/http";
import { ROUTE_LIMITS } from "@/lib/ai/policy";
import { DAILY_WINDOW_MS } from "@/lib/ai/quota";

/** SQLite and the provider key exist only on the Node runtime, never on Edge. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export async function POST(req: Request) {
  const guard = await guardedMutation(req, {
    limit: ROUTE_LIMITS.userRequestsPerMinute,
    windowMs: 60_000,
    adminOnly: true,
  });
  if (guard.error) return guard.error;
  const user = guard.user;
  if (!user) return jsonError("Autenticazione richiesta.", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("Richiesta non valida.");
  }

  // The task id is generated server-side: audit rows cannot be spoofed by a client.
  const parsed = parseAiRequest(body, newId("tsk"));
  if (!parsed.ok) return jsonError(parsed.error, parsed.status);

  const ai = getAiRuntime();
  if (!ai.status.enabled) {
    return jsonError(
      "AI Collective non attivo: serve l'opt-in esplicito e una chiave configurata solo sul server.",
      503,
    );
  }

  // Per-account daily budget, shared by every process on the same database.
  const withinBudget = ai.store.claimWindow(`ai:user:${user.id}`, ROUTE_LIMITS.perUserPerDay, DAILY_WINDOW_MS);
  if (!withinBudget) {
    return NextResponse.json(
      {
        ok: false,
        code: "QUOTA_EXHAUSTED",
        error: "Budget AI giornaliero del tuo account esaurito.",
      },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "3600" } },
    );
  }

  const result = await ai.run(parsed.task, parsed.prompt);
  const response = toAiResponse(result);
  return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
}
