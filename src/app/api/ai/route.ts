/**
 * Server-only entry point for the free-only AI Collective.
 *
 * Security decisions, all deliberate:
 * - admin only: a prompt leaves the host, so a tenant client cannot trigger it;
 * - session cookie + same-origin check via the existing `guardedMutation`;
 * - the data classification is forced to PUBLIC by `parseAiRequest`, never read
 *   from the body, so INTERNAL/CONFIDENTIAL/SECRET work cannot reach a hosted
 *   free model. Forcing the label is not proof that the text is public, so the
 *   admin must also confirm it explicitly;
 * - the admin attests per request that the text is PUBLIC; the attestation is
 *   persisted with the task id and the user, and a request without it is refused;
 * - the body is read with a 512 KiB ceiling before any JSON parsing, so an
 *   unbounded stream is never buffered in memory;
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
import { parseAiRequest, readJsonBody, toAiResponse } from "@/lib/ai/http";
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

  // Bounded read before parsing: Content-Length is checked, the stream is capped
  // anyway, and malformed JSON or UTF-8 becomes a 400 instead of an exception.
  const read = await readJsonBody(req);
  if (!read.ok) return jsonError(read.error, read.status);

  // The task id is generated server-side: audit rows cannot be spoofed by a client.
  const parsed = parseAiRequest(read.value, newId("tsk"));
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

  // Recorded before the provider call. If the attestation cannot be stored the
  // prompt is not sent: an unrecorded send is not acceptable.
  try {
    ai.store.recordAttestation({
      taskId: parsed.task.taskId,
      userId: user.id,
      statementVersion: parsed.attestationVersion,
      attestedAtMs: Date.now(),
    });
  } catch {
    return jsonError("Registrazione dell'attestazione non disponibile: nessun invio.", 503);
  }

  const result = await ai.run(parsed.task, parsed.prompt);
  const response = toAiResponse(result);
  return NextResponse.json(response.body, { status: response.status, headers: NO_STORE });
}
