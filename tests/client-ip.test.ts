import assert from "node:assert/strict";
import test from "node:test";
import { resolveClientIp, type HeaderReader } from "../src/lib/client-ip";

const from =
  (headers: Record<string, string>): HeaderReader =>
  (name) =>
    headers[name.toLowerCase()] ?? null;

test("client-supplied x-forwarded-for cannot rotate the rate-limit bucket", () => {
  // A caller that writes its own header lands as the leftmost hop; the address
  // appended by the proxy is the one we must key on.
  const spoofed = from({ "x-forwarded-for": "1.2.3.4, 198.51.100.9" });
  const spoofedAgain = from({ "x-forwarded-for": "9.9.9.9, 198.51.100.9" });
  assert.equal(resolveClientIp(spoofed), "198.51.100.9");
  assert.equal(resolveClientIp(spoofedAgain), resolveClientIp(spoofed));
});

test("x-real-ip set by the proxy wins over a forged forwarded chain", () => {
  const read = from({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6, 198.51.100.9" });
  assert.equal(resolveClientIp(read), "203.0.113.7");
});

test("a comma list in x-real-ip is not trusted", () => {
  const read = from({ "x-real-ip": "1.1.1.1, 2.2.2.2", "x-forwarded-for": "198.51.100.9" });
  assert.equal(resolveClientIp(read), "198.51.100.9");
});

test("ports, brackets and quotes are normalised away", () => {
  assert.equal(resolveClientIp(from({ "x-real-ip": "203.0.113.7:51234" })), "203.0.113.7");
  assert.equal(resolveClientIp(from({ "x-real-ip": '"203.0.113.7"' })), "203.0.113.7");
  assert.equal(resolveClientIp(from({ "x-real-ip": "[2001:DB8::1]:443" })), "2001:db8::1");
  assert.equal(resolveClientIp(from({ "x-real-ip": "fe80::1%eth0" })), "fe80::1");
});

test("unparseable values are skipped instead of reaching the audit trail", () => {
  assert.equal(resolveClientIp(from({ "x-real-ip": "not-an-ip" })), "local");
  assert.equal(resolveClientIp(from({ "x-real-ip": "999.1.1.1" })), "local");
  assert.equal(
    resolveClientIp(from({ "x-real-ip": "garbage", "x-forwarded-for": "junk, 198.51.100.9" })),
    "198.51.100.9",
  );
});

test("missing headers fall back to a stable placeholder", () => {
  assert.equal(resolveClientIp(() => null), "local");
  assert.equal(resolveClientIp(from({ "x-forwarded-for": "   " })), "local");
});
