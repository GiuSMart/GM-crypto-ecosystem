/**
 * Optional read-only smoke test for OKX EEA Spot public market data.
 *
 * Disabled by default: without GM_OKX_SMOKE=true nothing runs and no request is made.
 * Usage: GM_OKX_SMOKE=true npm run smoke:okx
 */
import { OKX_SMOKE_ENV, runOkxSmokeIfEnabled } from "../src/lib/venues/okx-smoke";

async function main() {
  const report = await runOkxSmokeIfEnabled(process.env[OKX_SMOKE_ENV]);

  if (report.skipped) {
    console.log(`OKX smoke disattivato (${OKX_SMOKE_ENV} diverso da "true"): nessuna richiesta effettuata.`);
    console.log(`Per eseguirlo: ${OKX_SMOKE_ENV}=true npm run smoke:okx`);
    return;
  }

  for (const check of report.checks) {
    console.log(`${check.ok ? "ok     " : "FALLITO"} ${check.name}: ${check.detail}`);
  }
  if (!report.ok) {
    console.error(`OKX smoke FALLITO dopo ${report.requests} richieste pubbliche (${report.durationMs} ms).`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `OKX smoke superato: ${report.pair} (${report.instId}) bid ${report.bid} ask ${report.ask}, ` +
      `età book ${report.bookAgeMs} ms, ${report.requests} richieste pubbliche in ${report.durationMs} ms.`,
  );
}

main().catch((err) => {
  console.error("OKX smoke errore:", err);
  process.exitCode = 1;
});
