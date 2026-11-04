import test from "node:test";
import assert from "node:assert/strict";
import {
  MARKET_DATA_LICENCES,
  assertMarketDataDisplayAllowed,
  licenceStatusFor,
  marketDataDisplayDecision,
} from "../src/lib/venues/licensing";

test("OKX is recorded as requiring written consent before any display to third parties", () => {
  const okx = MARKET_DATA_LICENCES.okx;
  assert.equal(okx.status, "prohibited-without-written-consent");
  assert.equal(okx.redistributionRequiresConsent, true);
  assert.equal(okx.publicEndpointsCovered, true);
  assert.ok(okx.sourceUrl.includes("okx.com"));
  assert.ok(okx.notes.includes("§9.4"), "the record must cite the clause it relies on");
});

test("OKX market data cannot be shown in a customer-facing context", () => {
  const decision = marketDataDisplayDecision("okx", "customer-facing");
  assert.equal(decision.allowed, false);
  assert.equal(decision.status, "prohibited-without-written-consent");
  assert.ok(decision.reason.includes("consenso scritto"));
});

test("OKX market data remains usable for the operator's own internal analysis", () => {
  const decision = marketDataDisplayDecision("okx", "internal");
  assert.equal(decision.allowed, true);
  assert.ok(decision.reason.includes("interno"));
});

test("the throwing gate refuses a customer-facing OKX path", () => {
  assert.throws(() => assertMarketDataDisplayAllowed("okx", "customer-facing"), /Market data non visualizzabile/);
  assert.doesNotThrow(() => assertMarketDataDisplayAllowed("okx", "internal"));
});

test("unreviewed venues are not cleared for commercial display", () => {
  for (const venue of ["kraken", "coinbase", "bybit"]) {
    assert.equal(MARKET_DATA_LICENCES[venue].status, "unreviewed");
    assert.equal(marketDataDisplayDecision(venue, "customer-facing").allowed, false);
    assert.equal(marketDataDisplayDecision(venue, "internal").allowed, true);
  }
});

test("an unknown venue fails closed in every context", () => {
  const customer = marketDataDisplayDecision("mystery-venue", "customer-facing");
  assert.equal(customer.allowed, false);
  assert.equal(customer.status, "unknown-venue");

  const internal = marketDataDisplayDecision("mystery-venue", "internal");
  assert.equal(internal.allowed, false, "no licence entry means no implicit permission");
  assert.equal(licenceStatusFor("mystery-venue"), "unknown-venue");
});

test("a venue that has been explicitly cleared is allowed to display", () => {
  MARKET_DATA_LICENCES["test-cleared-venue"] = {
    venueId: "test-cleared-venue",
    status: "cleared",
    sourceUrl: "https://example.invalid/terms",
    checkedAt: "2026-11-04",
    redistributionRequiresConsent: false,
    publicEndpointsCovered: true,
    attributionRequired: true,
    notes: "Fixture used only to prove the gate opens for a cleared venue.",
  };
  try {
    assert.equal(marketDataDisplayDecision("test-cleared-venue", "customer-facing").allowed, true);
  } finally {
    delete MARKET_DATA_LICENCES["test-cleared-venue"];
  }
  assert.equal(marketDataDisplayDecision("test-cleared-venue", "customer-facing").allowed, false);
});
