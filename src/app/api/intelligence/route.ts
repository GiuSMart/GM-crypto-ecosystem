import { guardedMutation, jsonError, jsonOk } from "@/lib/api";
import { buildSnapshot, answer, analyse } from "@/lib/ai/intelligence";
import { audit } from "@/lib/audit";
import { clientMeta } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 45;

export async function POST(req: Request) {
  const { user, error } = await guardedMutation(req, { limit: 20, windowMs: 60_000 });
  if (error || !user) return error ?? jsonError("Autenticazione richiesta.", 401);

  let body: { question?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("Richiesta non valida.");
  }

  const question = String(body.question ?? "").slice(0, 600);
  const snapshot = await buildSnapshot(user.id);
  const reply = answer(question, snapshot);

  const { ip } = await clientMeta();
  audit(user.id, "ai.ask", reply.intent, { question: question.slice(0, 200) }, ip);

  return jsonOk({ ...reply, generatedAt: snapshot.generatedAt, insights: analyse(snapshot).map((i) => i.id) });
}
