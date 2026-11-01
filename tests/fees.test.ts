import test from "node:test";
import assert from "node:assert/strict";
import { feeCanDriveSignal } from "../src/lib/engine/fees";

test("unverified reference fees cannot drive executable signals", () => {
  assert.equal(feeCanDriveSignal("unverified"), false);
});

test("verified and explicitly user-confirmed fees can drive signals", () => {
  assert.equal(feeCanDriveSignal("verified"), true);
  assert.equal(feeCanDriveSignal("user"), true);
});
