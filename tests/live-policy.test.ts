import test from "node:test";
import assert from "node:assert/strict";
import { evaluateControlledLiveOrder } from "../src/lib/live-policy";

test("blocks an order when final owner approval is absent", () => {
  const policy = {
    mode: "controlled" as const, quoteCurrency: "EUR", maxOrderQuote: 100,
    maxDailyLossQuote: 20, maxExposureQuote: 200, maxOrdersPerHour: 2,
    maxSpreadPct: 0.2, maxSlippagePct: 0.1, maxBookAgeMs: 1000,
    allowedSymbols: ["BTC-EUR"],
  };
  const intent = {
    symbol: "BTC-EUR", side: "buy" as const, quoteNotional: 50,
    expectedSpreadPct: 0.1, expectedSlippagePct: 0.05, worstCaseLossAtStopQuote: 5,
  };
  const snapshot = {
    liveSwitchEnabled: true, ownerPolicyAuthorizationActive: true, finalOwnerApproval: false,
    routerImplemented: true, apiCredentialValid: true, apiPermission: "trade-only" as const,
    withdrawalsEnabled: false, authorizationMaxOrderQuote: 200, authorizationMaxDailyLossQuote: 80,
    killSwitchActive: false, balanceFresh: true,
    dailyRealizedLossQuote: 0, currentExposureQuote: 0, ordersLastHour: 0, orderBookAgeMs: 100,
  };
  const result = evaluateControlledLiveOrder(intent, policy, snapshot);
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Autorizzazione finale")));
});
