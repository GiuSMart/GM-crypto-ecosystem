import { ALLOWED_VENUE_HOSTS } from "../config";

/**
 * Shared guard for the base URL of every public market-data adapter.
 *
 * The allowlist lives in config (ALLOWED_VENUE_HOSTS) and is enforced here, so an
 * adapter cannot be pointed at an arbitrary host — for example through an environment
 * variable like BYBIT_API_BASE. Only unauthenticated public market-data origins belong
 * in the list.
 */
export class VenueHostError extends Error {}

export function assertAllowedVenueBase(raw: string, envName?: string): URL {
  const label = envName ?? "base URL";
  // eslint-disable-next-line no-control-regex
  if (!raw || /[\u0000-\u001f\u007f]/.test(raw)) {
    throw new VenueHostError(`${label}: URL non valida o vuota`);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new VenueHostError(`${label}: URL non valida (${JSON.stringify(raw)})`);
  }

  if (parsed.protocol !== "https:") {
    throw new VenueHostError(`${label}: solo https è ammesso (ricevuto ${parsed.protocol})`);
  }
  if (!ALLOWED_VENUE_HOSTS.includes(parsed.hostname)) {
    throw new VenueHostError(`${label}: host ${parsed.hostname} non in ALLOWED_VENUE_HOSTS`);
  }
  if (parsed.pathname !== "/") {
    throw new VenueHostError(`${label}: il percorso deve essere "/" (ricevuto ${parsed.pathname})`);
  }
  if (parsed.port !== "") {
    throw new VenueHostError(`${label}: porta esplicita ${parsed.port} non ammessa`);
  }
  if (parsed.username || parsed.password) {
    throw new VenueHostError(`${label}: credenziali nell'URL non ammesse`);
  }
  if (parsed.search || parsed.hash) {
    throw new VenueHostError(`${label}: query o fragment nell'URL base non ammessi`);
  }
  return parsed;
}
