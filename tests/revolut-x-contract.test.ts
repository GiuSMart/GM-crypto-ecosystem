import assert from "node:assert/strict";
import test from "node:test";
import {
  REVOLUT_X_ORIGIN,
  buildSigningMessage,
  dashSymbol,
  publicPath,
  publicUrl,
  serializeQuery,
  signedPath,
  signedUrl,
  slashSymbol,
} from "../src/lib/venues/revolut-x";

test("public market data stays on the 2.0 path documented by Revolut X", () => {
  assert.equal(
    publicUrl("/api/2.0/public/order-book/BTC-USD"),
    `${REVOLUT_X_ORIGIN}/api/2.0/public/order-book/BTC-USD`,
  );
  // The upstream llm reference implies 1.0 for everything: that path must not be emitted.
  assert.throws(() => publicPath("/api/1.0/public/order-book/BTC-USD"), /2\.0\/public/);
  assert.throws(() => publicUrl("/api/public/order-book/BTC-USD"), /2\.0\/public/);
});

test("authenticated paths stay on 1.0 and cannot be confused with public ones", () => {
  assert.equal(signedUrl("/api/1.0/orders/active"), `${REVOLUT_X_ORIGIN}/api/1.0/orders/active`);
  assert.throws(() => signedPath("/api/2.0/public/order-book/BTC-USD"), /1\.0/);
  assert.throws(() => signedPath("/api/2.0/orders"), /1\.0/);
});

test("paths reject absolute URLs, traversal and embedded queries", () => {
  for (const bad of ["https://evil.example/api/1.0/orders", "api/1.0/orders", "/api/1.0/../../x", "/api/1.0/orders?limit=1", "/api/1.0/orders#frag"]) {
    assert.throws(() => signedPath(bad), /non valido|esce dalla radice|query/);
  }
});

test("query strings are stable and sorted so two runs sign the same bytes", () => {
  assert.equal(serializeQuery({ limit: 10, status: "open" }), "?limit=10&status=open");
  assert.equal(serializeQuery({}), "");
  assert.equal(serializeQuery(undefined), "");
  assert.equal(serializeQuery({ a: 1, b: undefined }), "?a=1");
});

test("symbols are dash-delimited in requests and slash-delimited in responses", () => {
  assert.equal(dashSymbol("btc/usd"), "BTC-USD");
  assert.equal(dashSymbol(" BTC-USD "), "BTC-USD");
  assert.equal(slashSymbol("BTC-USD"), "BTC/USD");
  for (const bad of ["BTC", "BTC-USD-EUR", "BTC USD", ""]) {
    assert.throws(() => dashSymbol(bad), /Coppia non valida/);
  }
});

test("the signing message follows the documented concatenation order", () => {
  const message = buildSigningMessage({
    timestampMs: 1765360896219,
    method: "GET",
    path: "/api/1.0/orders/active",
    query: { order_states: "new,partially_filled", limit: 10 },
  });
  // Official example: timestamp + METHOD + path + query + body, no separators.
  assert.equal(message, "1765360896219GET/api/1.0/orders/activelimit=10&order_states=new%2Cpartially_filled");
});

test("the signing message rejects inputs that would produce an invalid signature", () => {
  assert.throws(
    () => buildSigningMessage({ timestampMs: 1765360896, method: "GET", path: "/api/1.0/orders" }),
    /millisecondi/,
  );
  assert.throws(
    () => buildSigningMessage({ timestampMs: 1765360896219, method: "GET", path: "/1.0/orders" }),
    /parte da \/api\//,
  );
  assert.throws(
    () =>
      buildSigningMessage({
        timestampMs: 1765360896219,
        method: "POST",
        path: "/api/1.0/orders",
        body: '{ "symbol": "BTC-USD" }',
      }),
    /minificato/,
  );
});

test("a public path is never signed as an authenticated request", () => {
  assert.throws(
    () =>
      buildSigningMessage({
        timestampMs: 1765360896219,
        method: "GET",
        path: "/api/2.0/public/order-book/BTC-USD",
      }),
    /1\.0/,
  );
});
