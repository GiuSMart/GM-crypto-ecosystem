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
