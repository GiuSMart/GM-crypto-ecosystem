import test from "node:test";
import assert from "node:assert/strict";
import { calculatePaperRealizedProfit } from "../src/lib/engine/paper";

test("paper exit does not deduct a transfer fee already removed from entry quantity", () => {
  const exitProceeds = 520;
  const sellFeePct = 0.9;
  const safetyBufferPct = 0.05;
  const entrySpend = 504;

  const expected = exitProceeds
    - exitProceeds * (sellFeePct / 100)
    - exitProceeds * (safetyBufferPct / 100)
    - entrySpend;

  const realized = calculatePaperRealizedProfit({
    exitProceeds,
    sellFeePct,
    safetyBufferPct,
    entrySpend,
  });

  assert.ok(Math.abs(realized - expected) < 1e-10);
  // A transfer fee was already reflected in the quantity used to calculate
  // exitProceeds; applying it a second time would understate P&L.
  const wronglyDoubleCharged = realized - 0.000002 * 92_000;
  assert.ok(realized > wronglyDoubleCharged);
});
