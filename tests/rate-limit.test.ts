import assert from "node:assert/strict";
import test from "node:test";
import { throttled } from "../src/lib/rate-limit";

test("concurrent calls for one venue are serialized with minimum start spacing", async () => {
  const starts: number[] = [];
  await Promise.all(
    Array.from({ length: 3 }, () =>
      throttled("test-venue-queue", 20, async () => {
        starts.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 1));
      }),
    ),
  );

  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 18, `second request started after ${starts[1] - starts[0]}ms`);
  assert.ok(starts[2] - starts[1] >= 18, `third request started after ${starts[2] - starts[1]}ms`);
});
