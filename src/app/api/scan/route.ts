import { guardedMutation, jsonError, jsonOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import { clientMeta } from "@/lib/auth";
import { runScan } from "@/lib/market";
import { planLimits } from "@/lib/plans";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { user, error } = await guardedMutation(req, { limit: 10, windowMs: 60_000 });
  if (error || !user) return error ?? jsonError("Autenticazione richiesta.", 401);

  const plan = planLimits(user.plan);
  const perMinute = Math.max(1, Math.ceil(plan.scansPerHour / 60));
  const rl = rateLimit(`scan:${user.id}`, perMinute, 60_000);
  if (!rl.ok) {
    return jsonError(`Limite del piano ${user.plan.toUpperCase()}: ${plan.scansPerHour} scansioni/ora. Attendi.`, 429, {
      retryAfterSec: rl.retryAfterSec,
    });
  }

  try {
    const summary = await runScan(user.id, { limitCandidates: Math.min(6, Math.max(2, plan.pairs)) });
    const { ip } = await clientMeta();
    audit(user.id, "scan.run", summary.id, { candidates: summary.candidates, executable: summary.executable }, ip);
    return jsonOk(summary, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return jsonError(`Scansione non riuscita: ${(err as Error).message}`, 502);
  }
}
