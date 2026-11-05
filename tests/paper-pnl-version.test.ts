import test from "node:test";
import assert from "node:assert/strict";

import {
  LEGACY_PAPER_PNL_FORMULA_VERSION,
  PAPER_PNL_FORMULA_VERSION,
  classifyPaperPnlVersion,
  summarizePaperPnl,
  type PaperPnlInput,
} from "../src/lib/engine/paper-analytics";

const closed = (over: Partial<PaperPnlInput> = {}): PaperPnlInput => ({
  status: "closed",
  formulaVersion: PAPER_PNL_FORMULA_VERSION,
  expectedProfit: 0,
  realizedProfit: 0,
  realizedMarginPct: 0,
  ...over,
});

const open = (over: Partial<PaperPnlInput> = {}): PaperPnlInput => ({
  status: "open",
  formulaVersion: PAPER_PNL_FORMULA_VERSION,
  expectedProfit: 12,
  realizedProfit: Number.NaN,
  realizedMarginPct: null,
  ...over,
});

/* -------------------------------------------------------------------------- */
/* Classification                                                              */
/* -------------------------------------------------------------------------- */

test("the current formula is the only official one", () => {
  assert.equal(PAPER_PNL_FORMULA_VERSION, 2);
  assert.equal(LEGACY_PAPER_PNL_FORMULA_VERSION, 1);
  assert.equal(classifyPaperPnlVersion(2), 2);
});

test("legacy, missing and unrecognised versions all classify as historical", () => {
  // Fail closed: anything that is not exactly the current version is history.
  assert.equal(classifyPaperPnlVersion(1), "legacy");
  assert.equal(classifyPaperPnlVersion(null), "legacy");
  assert.equal(classifyPaperPnlVersion(3), "legacy");
  assert.equal(classifyPaperPnlVersion(0), "legacy");
  assert.equal(classifyPaperPnlVersion(Number.NaN), "legacy");
});

/* -------------------------------------------------------------------------- */
/* Aggregation split                                                           */
/* -------------------------------------------------------------------------- */

test("comparable and legacy results are aggregated separately and never summed", () => {
  const summary = summarizePaperPnl([
    closed({ expectedProfit: 20, realizedProfit: 10, realizedMarginPct: 1 }),
    closed({ expectedProfit: 10, realizedProfit: -5, realizedMarginPct: -0.5 }),
    closed({ expectedProfit: 5, realizedProfit: 0, realizedMarginPct: 0 }),
    // Closed under the previous formula: the transfer fee was charged twice.
    closed({ formulaVersion: LEGACY_PAPER_PNL_FORMULA_VERSION, expectedProfit: 10, realizedProfit: -20, realizedMarginPct: -2 }),
    closed({ formulaVersion: LEGACY_PAPER_PNL_FORMULA_VERSION, expectedProfit: 15, realizedProfit: -30, realizedMarginPct: -3 }),
    // A trade opened under the previous formula and still open belongs to neither series.
    open({ formulaVersion: LEGACY_PAPER_PNL_FORMULA_VERSION }),
  ]);

  assert.equal(summary.comparable.closedCount, 3);
  assert.equal(summary.comparable.realizedTotal, 5, "il totale ufficiale non deve includere i risultati V1");
  assert.equal(summary.comparable.expectedTotal, 35);
  assert.equal(summary.comparable.delta, 5 - 35);
  assert.equal(summary.comparable.wins, 1);
  assert.equal(summary.comparable.losses, 1, "il pareggio non è una perdita");
  assert.equal(summary.comparable.winRate, (1 / 3) * 100);
  assert.equal(summary.comparable.profitFactor, 2, "10 di profitti lordi / 5 di perdite lorde");
  assert.equal(summary.comparable.averageWin, 10);
  assert.equal(summary.comparable.averageLoss, -5);
  assert.equal(summary.comparable.bestTrade, 10);
  assert.equal(summary.comparable.worstTrade, -5);

  assert.equal(summary.legacy.closedCount, 2);
  assert.equal(summary.legacy.realizedTotal, -50);
  assert.equal(summary.legacy.wins, 0);
  assert.equal(summary.legacy.losses, 2);
  assert.equal(summary.legacy.winRate, 0);
  assert.equal(summary.legacy.profitFactor, 0);
  assert.equal(summary.legacy.averageWin, null, "senza trade positivi non esiste una vincita media");
  assert.equal(summary.legacy.averageLoss, -25);

  assert.equal(summary.unknownResultCount, 0);
});

test("the official total is exactly the sum of the current-formula closes", () => {
  const onlyLegacy = summarizePaperPnl([
    closed({ formulaVersion: LEGACY_PAPER_PNL_FORMULA_VERSION, realizedProfit: -100 }),
    closed({ formulaVersion: LEGACY_PAPER_PNL_FORMULA_VERSION, realizedProfit: 40 }),
  ]);

  assert.equal(onlyLegacy.comparable.closedCount, 0);
  assert.equal(onlyLegacy.comparable.realizedTotal, 0);
  assert.equal(onlyLegacy.comparable.winRate, null, "nessuna chiusura comparabile: nessun win rate inventato");
  assert.equal(onlyLegacy.comparable.profitFactor, null);
  assert.equal(onlyLegacy.comparable.bestTrade, null);
  assert.equal(onlyLegacy.legacy.realizedTotal, -60);
});

test("open trades are excluded until they are closed with the current formula", () => {
  const summary = summarizePaperPnl([
    open({ formulaVersion: LEGACY_PAPER_PNL_FORMULA_VERSION, expectedProfit: 50 }),
    open({ expectedProfit: 70 }),
  ]);

  assert.equal(summary.comparable.closedCount, 0);
  assert.equal(summary.legacy.closedCount, 0);
  assert.equal(summary.comparable.realizedTotal, 0);
  assert.equal(summary.unknownResultCount, 0);
});

test("a closed trade whose result is not a finite number is reported, not counted", () => {
  const summary = summarizePaperPnl([
    closed({ realizedProfit: 8 }),
    closed({ realizedProfit: Number.NaN }),
    closed({ formulaVersion: LEGACY_PAPER_PNL_FORMULA_VERSION, realizedProfit: Number.POSITIVE_INFINITY }),
  ]);

  assert.equal(summary.unknownResultCount, 2);
  assert.equal(summary.comparable.closedCount, 1);
  assert.equal(summary.comparable.realizedTotal, 8);
  assert.equal(summary.legacy.closedCount, 0, "un risultato non finito non entra nemmeno nello storico");
});

test("a missing margin is skipped instead of being read as zero", () => {
  const summary = summarizePaperPnl([
    closed({ realizedProfit: 10, realizedMarginPct: 2 }),
    closed({ realizedProfit: 4, realizedMarginPct: null }),
    closed({ realizedProfit: 2, realizedMarginPct: Number.NaN }),
  ]);

  assert.equal(summary.comparable.closedCount, 3);
  // (2) / 1, not 2/3: the unknown margins are unknown, not zero.
  assert.equal(summary.comparable.avgRealizedMarginPct, 2);
});
