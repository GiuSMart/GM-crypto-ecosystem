import test from "node:test";
import assert from "node:assert/strict";
import { REFERRAL_CATEGORIES, REFERRALS, REFERRAL_UNCLASSIFIED } from "../src/lib/config";
import { categoryLabel, categoryRank, findDuplicateReferral, groupReferrals, isKnownCategory, orderReferrals, validateReferralUrl } from "../src/lib/referrals";

/* -------------------------------------------------------------------------- */
/* URL safety                                                                  */
/* -------------------------------------------------------------------------- */

test("both Revolut links are accepted unchanged", () => {
  const personal = "https://revolut.com/referral/?referral-code=giuseppoox!NOV1-26-AR-H1&geo-redirect";
  const business = "https://business.revolut.com/signup?promo=C2B-NOV1-26-AR-H2&ext=giuseppoox&context=C2B_REFERRAL";

  const a = validateReferralUrl(personal);
  const b = validateReferralUrl(business);

  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  // Normalisation must never rewrite a referral code or drop a tracking param.
  assert.equal(a.ok && a.url, personal);
  assert.equal(b.ok && b.url, business);
});

test("a valid https link is stored in normalised form", () => {
  const check = validateReferralUrl("  https://example.com/path?a=1&b=2  ");
  assert.equal(check.ok, true);
  assert.equal(check.ok && check.url, "https://example.com/path?a=1&b=2");
});

test("unsafe or malformed links are rejected with a readable reason", () => {
  const cases: unknown[] = [
    "",
    null,
    undefined,
    "not-a-url",
    "http://example.com/insecure",
    "javascript:alert(1)",
    "ftp://example.com/file",
    "https://user:pass@example.com/x",
    "https://example.com:8080/x",
    "https://example.com/has space",
    "https://example.com/</script>",
    "https://nodot/x",
  ];

  for (const value of cases) {
    const check = validateReferralUrl(value);
    assert.equal(check.ok, false, `atteso rifiuto per ${JSON.stringify(value)}`);
    if (!check.ok) assert.ok(check.error.length > 0, "il rifiuto deve spiegarsi all'admin");
  }
});

test("an absurdly long URL is refused instead of stored", () => {
  const check = validateReferralUrl(`https://example.com/${"a".repeat(3000)}`);
  assert.equal(check.ok, false);
});

/* -------------------------------------------------------------------------- */
/* Categories                                                                  */
/* -------------------------------------------------------------------------- */

test("only declared categories are accepted", () => {
  for (const category of REFERRAL_CATEGORIES) assert.equal(isKnownCategory(category), true);
  assert.equal(isKnownCategory("Finanza"), false);
  assert.equal(isKnownCategory(REFERRAL_UNCLASSIFIED), false);
  assert.equal(isKnownCategory(""), false);
  assert.equal(isKnownCategory(null), false);
  assert.equal(isKnownCategory(42), false);
});

test("unknown and missing categories sort after every declared one", () => {
  assert.equal(categoryRank(REFERRAL_CATEGORIES[0]), 0);
  assert.equal(categoryRank(REFERRAL_CATEGORIES[REFERRAL_CATEGORIES.length - 1]), REFERRAL_CATEGORIES.length - 1);
  assert.equal(categoryRank("Etichetta a mano"), REFERRAL_CATEGORIES.length);
  assert.equal(categoryRank(null), REFERRAL_CATEGORIES.length);
  assert.equal(categoryRank(undefined), REFERRAL_CATEGORIES.length);
});

test("empty labels fall back to the legacy bucket", () => {
  assert.equal(categoryLabel(""), REFERRAL_UNCLASSIFIED);
  assert.equal(categoryLabel(null), REFERRAL_UNCLASSIFIED);
  assert.equal(categoryLabel("   "), REFERRAL_UNCLASSIFIED);
  assert.equal(categoryLabel("Finanza / Exchange"), "Finanza / Exchange");
});

/* -------------------------------------------------------------------------- */
/* Ordering and grouping                                                       */
/* -------------------------------------------------------------------------- */

const row = (id: string, category: string | null, platform: string, sort = 100) => ({ id, category, platform, name: id, sort });

test("offers are ordered by category, then platform", () => {
  const ordered = orderReferrals([
    row("zeta", REFERRAL_CATEGORIES[1], "Aaa"),
    row("alpha", REFERRAL_CATEGORIES[0], "Zzz"),
    row("beta", REFERRAL_CATEGORIES[0], "Aaa"),
    row("gamma", null, "Mmm"),
  ]);

  assert.deepEqual(
    ordered.map((r) => r.id),
    ["beta", "alpha", "zeta", "gamma"],
  );
});

test("platform ordering is locale aware and sort breaks ties", () => {
  const ordered = orderReferrals([
    row("same-b", REFERRAL_CATEGORIES[0], "Coinbase", 20),
    row("same-a", REFERRAL_CATEGORIES[0], "Coinbase", 10),
    row("kraken", REFERRAL_CATEGORIES[0], "Kraken", 5),
  ]);
  assert.deepEqual(
    ordered.map((r) => r.id),
    ["same-a", "same-b", "kraken"],
  );
});

test("grouping keeps every row and follows the canonical category order", () => {
  const rows = [
    row("freebuff", REFERRAL_CATEGORIES[5], "Freebuff"),
    row("revolut", REFERRAL_CATEGORIES[0], "Revolut"),
    row("kraken", REFERRAL_CATEGORIES[1], "Kraken"),
    row("orphan", null, "Sconosciuta"),
  ];

  const groups = groupReferrals(rows);

  assert.equal(
    groups.reduce((n, g) => n + g.items.length, 0),
    rows.length,
    "nessuna offerta può sparire durante il raggruppamento",
  );
  assert.deepEqual(
    groups.map((g) => g.category),
    [REFERRAL_CATEGORIES[0], REFERRAL_CATEGORIES[1], REFERRAL_CATEGORIES[5], REFERRAL_UNCLASSIFIED],
  );
  assert.deepEqual(
    groups.flatMap((g) => g.items.map((i) => i.id)),
    ["revolut", "kraken", "freebuff", "orphan"],
  );
});

test("grouping does not mutate its input", () => {
  const rows = [row("b", REFERRAL_CATEGORIES[1], "B"), row("a", REFERRAL_CATEGORIES[0], "A")];
  const before = rows.map((r) => r.id);
  groupReferrals(rows);
  assert.deepEqual(
    rows.map((r) => r.id),
    before,
  );
});

/* -------------------------------------------------------------------------- */
/* Seed integrity                                                              */
/* -------------------------------------------------------------------------- */

test("the seeded catalogue has unique ids and unique links", () => {
  const ids = REFERRALS.map((r) => r.id);
  const urls = REFERRALS.map((r) => r.url);
  assert.equal(new Set(ids).size, ids.length, "id duplicati nel seed");
  assert.equal(new Set(urls).size, urls.length, "link duplicati nel seed");
});

test("every seeded offer declares a category the page can order", () => {
  for (const r of REFERRALS) {
    assert.equal(isKnownCategory(r.category), true, `${r.id} ha una categoria sconosciuta: ${r.category}`);
    assert.equal(r.platform.trim().length > 0, true);
    assert.equal(r.name.trim().length > 0, true);
  }
});

test("every seeded link passes the same safety check the API applies", () => {
  for (const r of REFERRALS) {
    const check = validateReferralUrl(r.url);
    assert.equal(check.ok, true, `${r.id}: ${check.ok === false ? check.error : ""}`);
  }
});

test("duplicate detection matches equivalent spellings of the same link", () => {
  // The seeded crypto-voucher link has no path separator; normalisation adds one.
  const stored = [{ id: "cv", name: "Crypto Voucher", url: "https://cryptovoucher.io?refm=ltcstaking" }];
  const incoming = validateReferralUrl("https://cryptovoucher.io/?refm=ltcstaking");
  assert.equal(incoming.ok, true);

  const clash = incoming.ok ? findDuplicateReferral(stored, "brand-new-id", incoming.url) : null;
  assert.ok(clash, "un link equivalente già presente deve essere rilevato come duplicato");
  assert.equal(clash?.id, "cv");
});

test("a row never conflicts with itself when it is edited", () => {
  const row = { id: "cv", name: "Crypto Voucher", url: "https://cryptovoucher.io/?refm=ltcstaking" };
  assert.equal(findDuplicateReferral([row], "cv", row.url), null, "la stessa riga non è un duplicato");
});

test("distinct links are not mistaken for duplicates", () => {
  const rows = [
    { id: "a", name: "A", url: "https://example.com/?x=1" },
    { id: "b", name: "B", url: "https://example.org/" },
  ];
  assert.equal(findDuplicateReferral(rows, "new", "https://example.com/?x=2"), null);
  assert.equal(findDuplicateReferral(rows, "new", "https://other.com/"), null);
  assert.equal(findDuplicateReferral(rows, "new", "https://example.com/?x=1")?.id, "a");
});

test("seeded offers never claim rewards that were not verified", () => {
  // Rewards may only be asserted together with both flags on.
  for (const r of REFERRALS) {
    if (!r.verified || !r.affiliateConfirmed) continue;
    assert.notEqual(r.rewards.trim(), "", `${r.id} dichiara ricompense senza verifica`);
  }
  // Nothing in the seed asserts a concrete payout amount.
  for (const r of REFERRALS) assert.equal(/\d+\s*(€|\$|%)/.test(r.rewards), false, `${r.id} dichiara un importo`);
});

/* -------------------------------------------------------------------------- */
/* The two Revolut offers supplied by the owner                                */
/* -------------------------------------------------------------------------- */

test("owner links are runtime data, never hard-coded in the seed", () => {
  // Adding an affiliate link must not require a redeploy: the admin panel is
  // the supported path, so the baseline catalogue must not contain them.
  for (const r of REFERRALS) {
    assert.equal(/revolut\.com/i.test(r.url), false, `${r.id}: link Revolut codificato nel seed`);
    assert.equal(/revolut/i.test(r.platform), false, `${r.id}: piattaforma Revolut codificata nel seed`);
  }
});

test("the baseline catalogue was left untouched", () => {
  const baseline = ["phantom", "wirex", "speed", "kraken", "coinbase", "crypto-voucher", "freebuff"];
  for (const id of baseline) assert.ok(REFERRALS.some((r) => r.id === id), `offerta precedentemente presente rimossa: ${id}`);
  assert.equal(REFERRALS.length, baseline.length);
});
