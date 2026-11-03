import { REFERRAL_CATEGORIES, REFERRAL_UNCLASSIFIED } from "./config";

/**
 * Pure helpers for the GM Affiliate Center.
 *
 * Everything here is deliberately free of I/O so the ordering rules, the
 * category allowlist and the URL safety checks can be unit-tested without a
 * database or an HTTP server. The admin API and both pages share this module,
 * which is what keeps the display order and the validation in step.
 */

export type ReferralCategory = (typeof REFERRAL_CATEGORIES)[number];

/** The admin API only accepts categories declared in REFERRAL_CATEGORIES. */
export function isKnownCategory(value: unknown): value is ReferralCategory {
  return typeof value === "string" && (REFERRAL_CATEGORIES as readonly string[]).includes(value);
}

export type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Structural safety check for an outbound affiliate link.
 *
 * Referral links point at arbitrary third-party domains, so this does NOT
 * maintain a domain allowlist (that would make the centre impossible to grow).
 * It only enforces the properties that matter for the page: https, a real
 * hostname, no embedded credentials, default port, no whitespace or control
 * characters, and a sane length.
 */
export function validateReferralUrl(raw: unknown): UrlCheck {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, error: "URL obbligatorio." };
  if (value.length > 2048) return { ok: false, error: "URL troppo lungo (massimo 2048 caratteri)." };
  // Whitespace and the characters that break out of an href attribute.
  if (/[\s\u0000-\u001f<>"'`\\]/.test(value)) return { ok: false, error: "URL non valido: contiene spazi o caratteri non consentiti." };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, error: "URL non valido: non è un indirizzo web completo." };
  }

  if (parsed.protocol !== "https:") return { ok: false, error: "Solo link https sono ammessi." };
  if (!parsed.hostname) return { ok: false, error: "URL non valido: manca il nome del sito." };
  if (!parsed.hostname.includes(".")) return { ok: false, error: "URL non valido: dominio incompleto." };
  if (parsed.username || parsed.password) return { ok: false, error: "URL non valido: non può contenere credenziali." };
  if (parsed.port && parsed.port !== "443") return { ok: false, error: "URL non valido: usa una porta diversa da 443." };

  // Normalised form is what gets stored, so duplicate detection compares like for like.
  return { ok: true, url: parsed.toString() };
}

/**
 * Look for an already-catalogued link that points at the same destination.
 *
 * Rows written before normalisation existed may store an equivalent but
 * textually different URL ("https://host?x=1" vs "https://host/?x=1"), so the
 * comparison runs on the normalised form of BOTH sides rather than on a plain
 * SQL equality. Returns the conflicting row, or null when it is safe to insert.
 */
export function findDuplicateReferral<T extends { id: string; name: string; url: string }>(
  rows: readonly T[],
  incomingId: string,
  normalisedUrl: string,
): T | null {
  for (const row of rows) {
    if (row.id === incomingId) continue;
    const stored = validateReferralUrl(row.url);
    const candidates = [stored.ok ? stored.url : "", row.url.trim()];
    if (candidates.includes(normalisedUrl)) return row;
  }
  return null;
}

/**
 * The two flags answer different questions and must never collapse into one
 * badge: `verified` is our own check of the offer's details, while
 * `affiliate_confirmed` is the owner stating that the link, its attribution and
 * its promotion are theirs. A confirmation from the owner is recorded as such
 * and is not presented as an independent verification of the provider's terms.
 */
export type VerificationBadge = { tone: "pos" | "gold" | "warn"; label: string };

export function verificationBadge(row: {
  verified: number | boolean;
  affiliate_confirmed: number | boolean;
}): VerificationBadge {
  if (row.verified) return { tone: "pos", label: "dati verificati" };
  if (row.affiliate_confirmed) return { tone: "gold", label: "confermato dal proprietario" };
  return { tone: "warn", label: "da verificare" };
}

/** Rank of a category inside the canonical ordering; unknown labels sort last. */
export function categoryRank(category: string | null | undefined): number {
  const index = typeof category === "string" ? (REFERRAL_CATEGORIES as readonly string[]).indexOf(category) : -1;
  return index === -1 ? REFERRAL_CATEGORIES.length : index;
}

/** Display label: empty or missing categories fall back to the legacy bucket. */
export function categoryLabel(category: string | null | undefined): string {
  return typeof category === "string" && category.trim() ? category : REFERRAL_UNCLASSIFIED;
}

export type ReferralRecord = {
  category: string | null;
  platform: string;
  name: string;
  sort: number;
};

/**
 * Category (canonical order) → platform → sort → name.
 * Every input row is preserved: nothing is dropped, so no offer can disappear
 * just because its category is missing or unknown.
 */
export function orderReferrals<T extends ReferralRecord>(rows: readonly T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      categoryRank(a.category) - categoryRank(b.category) ||
      a.platform.localeCompare(b.platform, "it") ||
      a.sort - b.sort ||
      a.name.localeCompare(b.name, "it"),
  );
}

/** Rows grouped for rendering, groups following the canonical category order. */
export function groupReferrals<T extends ReferralRecord>(rows: readonly T[]): { category: string; items: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const row of orderReferrals(rows)) {
    const key = categoryLabel(row.category);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return Array.from(groups, ([category, items]) => ({ category, items }));
}

/* ------------------------------------------------------------------ */
/* Writing a referral                                                  */
/* ------------------------------------------------------------------ */

/**
 * Flags arrive in three shapes depending on who built the request: the panel
 * sends booleans, a hand-written snapshot often copies the SQL values (1/0), and
 * a shell one-liner may send strings. Reading only `=== true` turned a stored 1
 * into 0 and a stored 0 into 1, so every accepted spelling maps here and
 * anything else is treated as "not provided".
 */
export function flagFrom(value: unknown): boolean | null {
  if (value === true || value === 1 || value === "1") return true;
  if (value === false || value === 0 || value === "0") return false;
  return null;
}

/** The columns an update can carry over from the stored row, as SQLite has them. */
export type ExistingReferral = {
  platform: string;
  name: string;
  url: string;
  category: string | null;
  tagline: string | null;
  description: string | null;
  how_it_works: string | null;
  tutorial: string | null;
  terms: string | null;
  rewards: string | null;
  verified: number;
  affiliate_confirmed: number;
  accent: string | null;
  active: number;
  sort: number;
};

export type ReferralWrite = {
  platform: string;
  name: string;
  url: string;
  category: string;
  tagline: string | null;
  description: string | null;
  howItWorks: string | null;
  tutorial: string;
  terms: string | null;
  rewards: string | null;
  verified: number;
  affiliateConfirmed: number;
  accent: string;
  active: number;
  sort: number;
};

export type ReferralWriteResult = { ok: true; row: ReferralWrite; urlChanged: boolean } | { ok: false; error: string };

function clampedSort(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(9999, Math.max(0, n));
}

/**
 * Builds the full row to write from what the request mentions plus what is already
 * stored.
 *
 * The upsert replaces every column, so an omitted field used to fall back to a
 * default: a snapshot with only id/platform/name/category/url cleared the texts,
 * reset `verified`/`affiliateConfirmed`, moved `sort` back to 100 and, worst of
 * all, reactivated an offer that had been deliberately switched off. A field that
 * is not mentioned now keeps its stored value; a field sent as an empty string or
 * null still clears it.
 */
export function mergeReferralInput(body: Record<string, unknown>, existing: ExistingReferral | null): ReferralWriteResult {
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);

  const text = (key: string, column: "tagline" | "description" | "how_it_works" | "terms" | "rewards", max: number) => {
    if (has(key)) return String(body[key] ?? "").slice(0, max) || null;
    return existing ? existing[column] : null;
  };

  const platform = has("platform") ? String(body.platform ?? "").trim().slice(0, 60) : existing?.platform ?? "";
  if (!platform) return { ok: false, error: "Piattaforma obbligatoria." };
  const name = has("name") ? String(body.name ?? "").trim().slice(0, 80) : existing?.name ?? "";
  if (!name) return { ok: false, error: "Nome obbligatorio." };

  const category = has("category") ? String(body.category ?? "").trim() : existing?.category ?? "";
  if (has("category") && !isKnownCategory(category)) {
    return { ok: false, error: `Categoria non valida. Scegli tra: ${REFERRAL_CATEGORIES.join(" · ")}` };
  }
  if (!category) return { ok: false, error: `Categoria obbligatoria. Scegli tra: ${REFERRAL_CATEGORIES.join(" · ")}` };

  let url: string;
  let urlChanged = false;
  if (has("url")) {
    const check = validateReferralUrl(body.url);
    if (!check.ok) return { ok: false, error: check.error };
    url = check.url;
    urlChanged = !existing || existing.url !== url;
  } else if (existing?.url) {
    url = existing.url;
  } else {
    return { ok: false, error: "URL https obbligatorio." };
  }

  const flag = (key: string, column: "verified" | "affiliate_confirmed" | "active", fallback: number) => {
    if (!has(key)) return existing ? existing[column] : fallback;
    const value = flagFrom(body[key]);
    if (value === null) return existing ? existing[column] : fallback;
    return value ? 1 : 0;
  };

  const tutorial = has("tutorial")
    ? JSON.stringify(Array.isArray(body.tutorial) ? (body.tutorial as unknown[]).map((t) => String(t).slice(0, 300)) : [])
    : existing?.tutorial ?? "[]";

  return {
    ok: true,
    urlChanged,
    row: {
      platform,
      name,
      url,
      category,
      tagline: text("tagline", "tagline", 160),
      description: text("description", "description", 1200),
      howItWorks: text("howItWorks", "how_it_works", 1200),
      tutorial,
      terms: text("terms", "terms", 800),
      rewards: text("rewards", "rewards", 300),
      verified: flag("verified", "verified", 0),
      affiliateConfirmed: flag("affiliateConfirmed", "affiliate_confirmed", 0),
      accent: has("accent") ? String(body.accent ?? "gold").slice(0, 20) || "gold" : existing?.accent ?? "gold",
      active: flag("active", "active", 1),
      sort: clampedSort(body.sort, existing?.sort ?? 100),
    },
  };
}
