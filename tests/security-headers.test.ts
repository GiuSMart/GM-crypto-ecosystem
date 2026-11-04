import assert from "node:assert/strict";
import test from "node:test";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "../src/lib/security-headers";

const directives = (policy: string) =>
  new Map(
    policy.split(";").map((part) => {
      const [name, ...value] = part.trim().split(/\s+/);
      return [name, value.join(" ")];
    }),
  );

test("production CSP locks the directives that XSS relies on", () => {
  const policy = directives(buildContentSecurityPolicy({ production: true }));
  assert.equal(policy.get("default-src"), "'self'");
  assert.equal(policy.get("object-src"), "'none'");
  assert.equal(policy.get("base-uri"), "'none'");
  assert.equal(policy.get("frame-ancestors"), "'none'");
  assert.equal(policy.get("form-action"), "'self'");
  assert.equal(policy.get("connect-src"), "'self'");
  assert.ok(policy.has("upgrade-insecure-requests"));
});

test("production CSP does not ship development escapes", () => {
  const value = buildContentSecurityPolicy({ production: true });
  assert.ok(!value.includes("'unsafe-eval'"), "unsafe-eval must not reach production");
  assert.ok(!/\bws:|wss:/.test(value), "production must not allow websockets");
});

test("development CSP allows eval and hot reload only", () => {
  const policy = directives(buildContentSecurityPolicy({ production: false }));
  assert.ok(policy.get("script-src")?.includes("'unsafe-eval'"));
  assert.ok(policy.get("connect-src")?.includes("ws:"));
  assert.ok(!policy.has("upgrade-insecure-requests"));
});

test("no remote origin is whitelisted for scripts, styles, fonts or images", () => {
  const value = buildContentSecurityPolicy({ production: true });
  assert.ok(!/https?:\/\//.test(value), `unexpected remote origin in ${value}`);
  const policy = directives(value);
  assert.equal(policy.get("script-src"), "'self' 'unsafe-inline'");
  assert.equal(policy.get("style-src"), "'self' 'unsafe-inline'");
});

test("every header is present and HSTS is production-only", () => {
  const prod = Object.fromEntries(buildSecurityHeaders({ production: true }).map((h) => [h.key, h.value]));
  const dev = Object.fromEntries(buildSecurityHeaders({ production: false }).map((h) => [h.key, h.value]));
  for (const key of [
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
    "Content-Security-Policy",
  ]) {
    assert.ok(prod[key], `missing ${key}`);
    assert.ok(dev[key], `missing ${key}`);
  }
  assert.equal(prod["Strict-Transport-Security"], "max-age=31536000");
  assert.equal(dev["Strict-Transport-Security"], undefined);
  assert.notEqual(prod["Content-Security-Policy"], dev["Content-Security-Policy"]);
});
