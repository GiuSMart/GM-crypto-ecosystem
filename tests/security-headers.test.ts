import assert from "node:assert/strict";
import test from "node:test";
import { buildContentSecurityPolicy, buildSecurityHeaders } from "../src/lib/security-headers";

const nonce = "dGVzdC1ub25jZS0xMjM0NTY3OA==";

const directives = (policy: string) =>
  new Map(
    policy.split(";").map((part) => {
      const [name, ...value] = part.trim().split(/\\s+/);
      return [name, value.join(" ")];
    }),
  );

test("production CSP authorizes scripts only with the per-request nonce", () => {
  const policy = directives(buildContentSecurityPolicy({ production: true, nonce }));
  assert.equal(policy.get("script-src"), `'self' 'nonce-${nonce}' 'strict-dynamic'`);
  assert.equal(policy.get("default-src"), "'self'");
  assert.equal(policy.get("object-src"), "'none'");
  assert.equal(policy.get("base-uri"), "'none'");
  assert.equal(policy.get("frame-ancestors"), "'none'");
  assert.equal(policy.get("form-action"), "'self'");
  assert.equal(policy.get("connect-src"), "'self'");
  assert.ok(policy.has("upgrade-insecure-requests"));
  assert.ok(!policy.get("script-src")?.includes("'unsafe-inline'"));
});

test("production CSP does not ship development script escapes", () => {
  const value = buildContentSecurityPolicy({ production: true, nonce });
  assert.ok(!value.includes("'unsafe-eval'"), "unsafe-eval must not reach production");
  assert.ok(!/\\bws:|wss:/.test(value), "production must not allow websockets");
});

test("development CSP allows eval and hot reload only in addition to the nonce", () => {
  const policy = directives(buildContentSecurityPolicy({ production: false, nonce }));
  assert.ok(policy.get("script-src")?.includes(`'nonce-${nonce}'`));
  assert.ok(policy.get("script-src")?.includes("'strict-dynamic'"));
  assert.ok(policy.get("script-src")?.includes("'unsafe-eval'"));
  assert.ok(policy.get("connect-src")?.includes("ws:"));
  assert.ok(!policy.has("upgrade-insecure-requests"));
});

test("inline style attributes remain allowed until UI style props are refactored", () => {
  const policy = directives(buildContentSecurityPolicy({ production: true, nonce }));
  assert.equal(policy.get("style-src"), "'self' 'unsafe-inline'");
});

test("no remote origin is whitelisted for scripts, styles, fonts or images", () => {
  const value = buildContentSecurityPolicy({ production: true, nonce });
  assert.ok(!/https?:\\/\\//.test(value), `unexpected remote origin in ${value}`);
});

test("invalid nonce values are rejected", () => {
  assert.throws(
    () => buildContentSecurityPolicy({ production: true, nonce: "not a nonce; script-src *" }),
    /valid per-request base64 CSP nonce/,
  );
});

test("every security header is present and HSTS is production-only", () => {
  const prod = Object.fromEntries(buildSecurityHeaders({ production: true, nonce }).map((h) => [h.key, h.value]));
  const dev = Object.fromEntries(buildSecurityHeaders({ production: false, nonce }).map((h) => [h.key, h.value]));
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
