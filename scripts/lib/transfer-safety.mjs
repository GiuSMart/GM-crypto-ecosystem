/**
 * Safety rules shared by the operator scripts that talk to a running instance.
 *
 * Two things are easy to get wrong when a tool posts an admin payload built from
 * a file, so both live here and are unit-tested instead of being buried in a
 * CLI:
 *
 *   1. the target URL. The scripts log in and send a password, so plain HTTP is
 *      only acceptable on the loopback interface, anything remote must be HTTPS
 *      on the standard port 443, and the URL must be a bare origin (no
 *      credentials, query, fragment or path), since the scripts append their
 *      own /api/... paths. A non-standard port is refused because it usually
 *      points at a hand-run proxy or tunnel that is not the instance the
 *      operator means to update.
 *   2. the payload. A snapshot is data, never instructions: only the referral
 *      fields below are forwarded, so a file cannot smuggle in a different
 *      action (delete_referral, revoke_live, ...) and make the import do
 *      something else than upsert referrals.
 */

/** Hosts where an unencrypted connection stays on the machine. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

/** The only port a remote instance may be reached on. */
const REMOTE_PORT = "443";

/**
 * Validates `--base` and returns the origin to talk to.
 * Throws with a message meant for the operator.
 */
export function resolveBaseUrl(raw) {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("base URL mancante");
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`base URL non valida: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`protocollo non supportato (${url.protocol}): usa https`);
  }
  if (url.username || url.password) throw new Error("la base URL non deve contenere credenziali");
  if (url.search) throw new Error("la base URL non deve contenere una query string");
  if (url.hash) throw new Error("la base URL non deve contenere un fragment");
  if (url.pathname !== "/" && url.pathname !== "") {
    throw new Error(`la base URL non deve contenere un percorso (${url.pathname})`);
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback = LOOPBACK_HOSTS.has(host);
  if (url.protocol === "http:" && !loopback) {
    throw new Error(`http è consentito solo su localhost, 127.0.0.1 e ::1: per ${url.host} usa https`);
  }
  // URL drops a default port, so an explicit :443 arrives here as "".
  if (!loopback && url.port !== "" && url.port !== REMOTE_PORT) {
    throw new Error(`porta ${url.port} non consentita per ${url.hostname}: fuori dal loopback usa la porta ${REMOTE_PORT}`);
  }
  return url.origin;
}

/**
 * Snapshot key → field accepted by POST /api/admin (action upsert_referral).
 * Exports use the database column names, hand-written snapshots tend to use the
 * API names, so both spellings are accepted for the same field.
 */
export const SNAPSHOT_FIELDS = Object.freeze({
  id: "id",
  platform: "platform",
  name: "name",
  category: "category",
  url: "url",
  tagline: "tagline",
  description: "description",
  how_it_works: "howItWorks",
  howItWorks: "howItWorks",
  terms: "terms",
  rewards: "rewards",
  accent: "accent",
  sort: "sort",
  tutorial: "tutorial",
  verified: "verified",
  affiliate_confirmed: "affiliateConfirmed",
  affiliateConfirmed: "affiliateConfirmed",
  active: "active",
});

/** Fields where an explicit null means "leave this empty" rather than "skip". */
const TEXT_FIELDS = new Set(["platform", "name", "category", "url", "tagline", "description", "howItWorks", "terms", "rewards", "accent"]);

/**
 * Builds the admin request body from a snapshot row.
 *
 * The action is fixed here and read from no input. An absent field is not sent,
 * so a partial snapshot only touches what it mentions; an explicit null empties
 * a free-text field, while null id/flags/sort are ignored (a null id would ask
 * the API to create a brand-new row, and a null active flag would re-enable an
 * offer that was deliberately switched off).
 */
export function referralAdminBody(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("riga non valida nello snapshot");
  const body = { action: "upsert_referral" };
  for (const [key, field] of Object.entries(SNAPSHOT_FIELDS)) {
    const value = row[key];
    if (value === undefined) continue;
    if (value === null) {
      if (TEXT_FIELDS.has(field)) body[field] = "";
      else if (field === "tutorial") body.tutorial = [];
      continue;
    }
    body[field] = value;
  }
  return body;
}

/**
 * The admin API stores the URL in its normalised form (URL#href), which inserts
 * a slash before a root query: "https://x.io?a=1" becomes "https://x.io/?a=1".
 * Comparisons use the same normalisation so a pre-normalisation snapshot still
 * matches what the page renders.
 */
export function normaliseUrl(url) {
  try {
    return new URL(url).href;
  } catch {
    return url;
  }
}
