import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORKER_INTERVAL_MS,
  MAX_WORKER_INTERVAL_MS,
  MIN_WORKER_INTERVAL_MS,
  isWorkerEnabled,
  workerIntervalMs,
} from "../src/lib/worker-config";

test("worker activation requires an explicit true value", () => {
  assert.equal(isWorkerEnabled(undefined), false);
  assert.equal(isWorkerEnabled(""), false);
  assert.equal(isWorkerEnabled("1"), false);
  assert.equal(isWorkerEnabled("false"), false);
  assert.equal(isWorkerEnabled(" TRUE "), true);
});

test("worker interval defaults safely for missing or invalid values", () => {
  assert.equal(workerIntervalMs(undefined), DEFAULT_WORKER_INTERVAL_MS);
  assert.equal(workerIntervalMs(""), DEFAULT_WORKER_INTERVAL_MS);
  assert.equal(workerIntervalMs("abc"), DEFAULT_WORKER_INTERVAL_MS);
  assert.equal(workerIntervalMs("1.5"), DEFAULT_WORKER_INTERVAL_MS);
  assert.equal(workerIntervalMs("-100"), DEFAULT_WORKER_INTERVAL_MS);
});

test("worker interval is bounded to safe minimum and maximum", () => {
  assert.equal(workerIntervalMs("1000"), MIN_WORKER_INTERVAL_MS);
  assert.equal(workerIntervalMs(String(MAX_WORKER_INTERVAL_MS * 2)), MAX_WORKER_INTERVAL_MS);
  assert.equal(workerIntervalMs("45000"), 45_000);
});
