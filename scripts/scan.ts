/**
 * Headless scan: `npm run scan`
 *
 * Runs the same engine used by the UI, persists the results and prints a summary.
 * Useful for a cron job or for verifying the pipeline without a browser.
 */
import { runScan } from "../src/lib/market";
import { getSettings } from "../src/lib/db";

async function main() {
  const settings = getSettings();
  console.log(
    `GM CRYPTO ARBITRAGE AI — scan ${settings.quote} | soglia ${settings.minMarginPct}% | notional ${settings.notionalQuote} | modalità ${settings.transferMode}`,
  );

  const summary = await runScan(null, { limitCandidates: 5 });

  console.log(`\ncoppie valutate: ${summary.pairsScanned}`);
  console.log(`candidati valutati: ${summary.candidates}`);
  console.log(`eseguibili: ${summary.executable}`);
  console.log(`durata: ${summary.durationMs} ms`);
  if (summary.errors.length) console.log(`avvisi:\n  - ${summary.errors.join("\n  - ")}`);

  for (const e of summary.evaluations) {
    console.log(
      `\n${e.pair}  ${e.buyVenue} -> ${e.sellVenue}` +
        `\n  spread lordo ${e.grossSpreadPct.toFixed(3)}% | fee ${(e.buyFee + e.sellFee).toFixed(2)}` +
        `\n  netto ${Number.isFinite(e.netProfit) ? e.netProfit.toFixed(2) : "n/d"} | margine ${Number.isFinite(e.marginPct) ? e.marginPct.toFixed(3) : "n/d"}%` +
        `\n  esito: ${e.executable ? "ESEGUIBILE" : `scartato — ${e.rejectReasons[0] ?? "n/d"}`}`,
    );
  }

  if (!summary.executable) {
    console.log("\nNO PROFIT = NO TRADE: nessuna operazione ammissibile in questa scansione.");
  }
}

main().catch((err) => {
  console.error("Scansione fallita:", err);
  process.exit(1);
});
