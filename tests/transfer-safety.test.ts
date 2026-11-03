import test from "node:test";
import assert from "node:assert/strict";
import { normaliseUrl, referralAdminBody, resolveBaseUrl, SNAPSHOT_FIELDS } from "../scripts/lib/transfer-safety.mjs";

/* -------------------------------------------------------------------------- */
/* An import can upsert referrals and nothing else                             */
/* -------------------------------------------------------------------------- */

const goodRow = {
  id: "revolut-invite",
  platform: "Revolut",
  name: "Revolut — Invita amici",
  category: "Finanza / Conto personale",
  url: "https://revolut.com/referral/?referral-code=test",
  affiliateConfirmed: true,
  active: true,
};

test("a malicious snapshot cannot swap the action of an import", () => {
  // The whole point of the transfer tool is moving the catalogue: a file that
  // asks for something else must be reduced to an upsert, not obeyed.
  const hostile = [
    "delete_referral",
    "revoke_live",
    "upsert_plan",
    "suspend_user",
    "set_role",
    "delete_user",
  ];
  for (const action of hostile) {
    const body = referralAdminBody({ ...goodRow, action });
    assert.equal(body.action, "upsert_referral", `azione «${action}» arrivata all'API`);
    assert.equal(JSON.stringify(body).includes(action), false, `«${action}» presente nel payload`);
  }
});

test("a malicious snapshot cannot smuggle extra fields", () => {
  const row = JSON.parse(
    JSON.stringify({
      ...goodRow,
      userId: "usr_1",
      role: "admin",
      priceCents: 0,
      plan: "pro",
      __proto__: { polluted: true },
    }),
  );
  const body = referralAdminBody(row);
  const allowed = new Set(["action", ...Object.values(SNAPSHOT_FIELDS)]);
  for (const key of Object.keys(body)) assert.ok(allowed.has(key), `campo non previsto inoltrato: ${key}`);
  assert.equal("userId" in body, false);
  assert.equal("plan" in body, false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined, "prototype polluted");
});

test("the action field is fixed and no snapshot key can point at it", () => {
  assert.equal(Object.values(SNAPSHOT_FIELDS).includes("action"), false);
  assert.equal(referralAdminBody({}).action, "upsert_referral");
  assert.equal(Object.keys(referralAdminBody({})).length, 1);
});

test("referral fields survive the import, including the owner confirmation", () => {
  const body = referralAdminBody(goodRow);
  assert.equal(body.id, "revolut-invite");
  assert.equal(body.affiliateConfirmed, true);
  assert.equal(body.active, true);
  // Export files carry the column spelling: it has to reach the camelCase field.
  const fromExport = referralAdminBody({ ...goodRow, how_it_works: "Apri il link", affiliate_confirmed: true });
  assert.equal(fromExport.howItWorks, "Apri il link");
  assert.equal(fromExport.affiliateConfirmed, true);
  assert.equal("how_it_works" in fromExport, false);
});

test("a null id or flag is ignored instead of creating or reviving a row", () => {
  const body = referralAdminBody({ ...goodRow, id: null, active: null, affiliateConfirmed: null, sort: null });
  assert.equal("id" in body, false, "un id nullo farebbe creare una riga nuova");
  assert.equal("active" in body, false, "un flag nullo riattiverebbe un'offerta spenta");
  assert.equal("affiliateConfirmed" in body, false);
  assert.equal("sort" in body, false);
});

test("a null text field empties it, an absent field is not touched", () => {
  const cleared = referralAdminBody({ ...goodRow, tagline: null, rewards: null, tutorial: null });
  assert.equal(cleared.tagline, "");
  assert.equal(cleared.rewards, "");
  assert.deepEqual(cleared.tutorial, []);
  const untouched = referralAdminBody({ ...goodRow });
  assert.equal("tagline" in untouched, false);
  assert.equal("tutorial" in untouched, false);
});

test("a row that is not an object is rejected", () => {
  for (const bad of [null, undefined, "revolut", 42, ["revolut-invite"]]) {
    assert.throws(() => referralAdminBody(bad), /riga non valida/);
  }
});

test("flags written as 0/1 in a snapshot keep their meaning", () => {
  const body = referralAdminBody({ ...goodRow, verified: 1, affiliateConfirmed: 0, active: 0 });
  assert.equal(body.verified, true);
  assert.equal(body.affiliateConfirmed, false);
  assert.equal(body.active, false, "una voce spenta non deve arrivare come attiva");
});

test("an unreadable flag is left out instead of guessed", () => {
  const body = referralAdminBody({ ...goodRow, verified: "sì", active: "yes" });
  assert.equal("verified" in body, false, "un valore incomprensibile non deve diventare false");
  assert.equal("active" in body, false);
  assert.equal(body.affiliateConfirmed, true);
});

/* -------------------------------------------------------------------------- */
/* Where a password may be sent                                                */
/* -------------------------------------------------------------------------- */

test("plain http is accepted only on the loopback interface", () => {
  assert.equal(resolveBaseUrl("http://127.0.0.1:3001"), "http://127.0.0.1:3001");
  assert.equal(resolveBaseUrl("http://localhost:3001"), "http://localhost:3001");
  assert.equal(resolveBaseUrl("http://[::1]:3001"), "http://[::1]:3001");
  assert.equal(resolveBaseUrl("http://LOCALHOST:3001/"), "http://localhost:3001");
});

test("a remote host always needs https", () => {
  const remote = ["http://app.example.com", "http://192.168.1.10:3001", "http://10.0.0.5", "http://affiliate.example.org:8080"];
  for (const base of remote) assert.throws(() => resolveBaseUrl(base), /http è consentito solo/, `${base} è stato accettato`);
  assert.equal(resolveBaseUrl("https://app.example.com"), "https://app.example.com");
});

test("a remote host is only reached on the standard https port", () => {
  const refused = ["https://app.example.com:8443", "https://app.example.com:3001", "https://app.example.com:80", "https://app.example.com:4430"];
  for (const base of refused) assert.throws(() => resolveBaseUrl(base), /porta .* non consentita/, `${base} è stato accettato`);
  // The URL API drops a default port, so an explicit :443 is accepted and normalised away.
  assert.equal(resolveBaseUrl("https://app.example.com:443"), "https://app.example.com");
  assert.equal(resolveBaseUrl("https://app.example.com"), "https://app.example.com");
});

test("the loopback interface keeps custom ports, including https", () => {
  assert.equal(resolveBaseUrl("http://127.0.0.1:3001"), "http://127.0.0.1:3001");
  assert.equal(resolveBaseUrl("http://localhost:8080"), "http://localhost:8080");
  assert.equal(resolveBaseUrl("https://127.0.0.1:8443"), "https://127.0.0.1:8443");
  assert.equal(resolveBaseUrl("https://[::1]:3001"), "https://[::1]:3001");
});

test("base URLs with credentials, query, fragment or path are refused", () => {
  const refused: [string, RegExp][] = [
    ["https://user:pass@app.example.com", /credenziali/],
    ["https://user@app.example.com", /credenziali/],
    ["https://app.example.com/?token=abc", /query/],
    ["https://app.example.com?token=abc", /query/],
    ["https://app.example.com/#frag", /fragment/],
    ["https://app.example.com/admin", /percorso/],
    ["http://127.0.0.1:3001/api", /percorso/],
  ];
  for (const [base, pattern] of refused) assert.throws(() => resolveBaseUrl(base), pattern, `${base} è stato accettato`);
});

test("non http protocols and empty input are refused", () => {
  assert.throws(() => resolveBaseUrl("file:///etc/passwd"), /protocollo/);
  assert.throws(() => resolveBaseUrl("ftp://example.com"), /protocollo/);
  assert.throws(() => resolveBaseUrl("javascript:alert(1)"), /non valida|protocollo/);
  assert.throws(() => resolveBaseUrl(""), /mancante/);
  assert.throws(() => resolveBaseUrl(null), /mancante/);
  assert.throws(() => resolveBaseUrl("non una url"), /non valida/);
});

/* -------------------------------------------------------------------------- */
/* URL comparison used by the import verification                             */
/* -------------------------------------------------------------------------- */

test("normalisation matches the form the admin API stores", () => {
  assert.equal(normaliseUrl("https://revolut.com/referral?code=1"), "https://revolut.com/referral?code=1");
  assert.equal(normaliseUrl("https://business.revolut.com/signup?promo=X&ext=Y"), "https://business.revolut.com/signup?promo=X&ext=Y");
  assert.equal(normaliseUrl("non una url"), "non una url");
});
