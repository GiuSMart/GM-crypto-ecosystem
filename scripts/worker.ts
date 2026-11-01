/**
 * Single-process server market worker.
 *
 * Start with GM_WORKER_ENABLED=true npm run worker.
 * Keep exactly one worker instance and mount the same persistent data volume
 * used by the web process. This worker never places orders.
 */
import { runScan } from "../src/lib/market";
import { isWorkerEnabled, workerIntervalMs } from "../src/lib/worker-config";

if (!isWorkerEnabled(process.env.GM_WORKER_ENABLED)) {
  console.error("Worker disattivato. Imposta GM_WORKER_ENABLED=true per avviarlo esplicitamente.");
  process.exit(1);
}

const intervalMs = workerIntervalMs(process.env.GM_WORKER_INTERVAL_MS);
let stopping = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;

function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  if (timer) clearTimeout(timer);
  console.log(`[gm-worker] Arresto richiesto (${signal}); attendo la scansione in corso.`);
  if (!running) process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

async function tick(): Promise<void> {
  if (stopping || running) return;
  running = true;
  const startedAt = new Date().toISOString();
  const started = Date.now();

  try {
    const summary = await runScan(null, { limitCandidates: 5 });
    console.log(
      JSON.stringify({
        service: "gm-market-worker",
        status: summary.errors.length ? "completed_with_warnings" : "ok",
        startedAt,
        finishedAt: new Date().toISOString(),
        scanId: summary.id,
        pairsScanned: summary.pairsScanned,
        candidates: summary.candidates,
        executable: summary.executable,
        durationMs: Date.now() - started,
        warningCount: summary.errors.length,
      }),
    );
    for (const warning of summary.errors.slice(0, 5)) {
      console.warn(`[gm-worker] ${warning.slice(0, 300)}`);
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        service: "gm-market-worker",
        status: "error",
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - started,
        message: error instanceof Error ? error.message.slice(0, 300) : "Errore sconosciuto",
      }),
    );
  } finally {
    running = false;
    if (stopping) {
      process.exit(0);
      return;
    }
    // Delay is measured after completion: slow scans never overlap or pile up.
    timer = setTimeout(() => void tick(), intervalMs);
  }
}

console.log(`[gm-worker] Avviato; intervallo ${intervalMs} ms; scansioni pubbliche e sola lettura.`);
void tick();
