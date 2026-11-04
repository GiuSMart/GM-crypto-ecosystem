/**
 * Revolut X REST API contract, as verified against the official documentation on 2026-11-04
 * (https://developer.revolut.com/docs/api/revolut-x-crypto-exchange).
 *
 * The exchange splits its API by version:
 *   public, unauthenticated market data -> https://revx.revolut.com/api/2.0/public/...
 *   authenticated account/trading      -> https://revx.revolut.com/api/1.0/...
 *
 * The upstream `revolut-x-api-for-llm.md` still states `base URL https://revx.revolut.com/api/1.0`
 * and lists version-less paths, which produces `/api/1.0/public/order-book/...` and 404s. These
 * helpers reject that shape instead of emitting a request that can only fail.
 *
 * Nothing here sends requests, holds credentials or places orders: it only builds strings and
 * validates paths, so it stays testable offline.
 */

export const REVOLUT_X_ORIGIN = "https://revx.revolut.com";
export const REVOLUT_X_PUBLIC_PREFIX = "/api/2.0/public/";
export const REVOLUT_X_SIGNED_PREFIX = "/api/1.0/";

/** Public endpoints accept only market data; the prefix is asserted, never inferred. */
export function publicPath(path: string): string {
  const clean = assertRelativePath(path);
  if (!clean.startsWith(REVOLUT_X_PUBLIC_PREFIX)) {
    throw new Error(
      `Percorso pubblico Revolut X non valido: serve ${REVOLUT_X_PUBLIC_PREFIX}…, ricevuto "${clean}".`,
    );
  }
  return clean;
}

/** Authenticated endpoints live on 1.0; a public path must never be signed as if it were private. */
export function signedPath(path: string): string {
  const clean = assertRelativePath(path);
  if (!clean.startsWith(REVOLUT_X_SIGNED_PREFIX)) {
    throw new Error(
      `Percorso autenticato Revolut X non valido: serve ${REVOLUT_X_SIGNED_PREFIX}…, ricevuto "${clean}".`,
    );
  }
  return clean;
}

export function publicUrl(path: string, query?: Record<string, string | number | undefined>): string {
  return `${REVOLUT_X_ORIGIN}${publicPath(path)}${serializeQuery(query)}`;
}

export function signedUrl(path: string, query?: Record<string, string | number | undefined>): string {
  return `${REVOLUT_X_ORIGIN}${signedPath(path)}${serializeQuery(query)}`;
}

/** Path parameters use the dash form; response payloads use the slash form. */
export function dashSymbol(pair: string): string {
  const symbol = pair.trim().toUpperCase().replace("/", "-");
  if (!/^[A-Z0-9]{2,10}-[A-Z0-9]{2,10}$/.test(symbol)) {
    throw new Error(`Coppia non valida: "${pair}" (atteso BASE-QUOTE, es. BTC-USD).`);
  }
  return symbol;
}

/** Response symbols are slash-delimited (`BTC/USD`), so results must be normalised before storage. */
export function slashSymbol(pair: string): string {
  return dashSymbol(pair).replace("-", "/");
}

export type SigningInput = {
  /** X-Revx-Timestamp: Unix epoch milliseconds, as a string. */
  timestampMs: string | number;
  method: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  /** Full path from /api, e.g. /api/1.0/orders/active. */
  path: string;
  query?: Record<string, string | number | undefined>;
  /** Minified JSON body, byte-for-byte as it will be sent. Empty for GET/DELETE. */
  body?: string;
};

/**
 * Builds the exact string signed with the Ed25519 key: timestamp + METHOD + path + query + body,
 * concatenated with no separators. A body containing whitespace outside JSON strings cannot be
 * byte-identical to the minified body Revolut X hashes, so it is rejected rather than silently
 * producing a 401.
 */
export function buildSigningMessage(input: SigningInput): string {
  const timestamp = String(input.timestampMs);
  // Revolut X expects milliseconds (13 digits); a 10-digit seconds value is a silent 409.
  if (!/^\d{13}$/.test(timestamp)) {
    throw new Error("Timestamp non valido: servono millisecondi Unix (13 cifre).");
  }
  if (!input.path.startsWith("/api/")) {
    throw new Error(`Il percorso da firmare parte da /api/, ricevuto "${input.path}".`);
  }
  signedPath(input.path);
  const query = serializeQuery(input.query).slice(1);
  const body = input.body ?? "";
  if (body) {
    let canonical: string;
    try {
      canonical = JSON.stringify(JSON.parse(body));
    } catch {
      throw new Error("Il body firmato deve essere JSON valido.");
    }
    // The signature covers the exact bytes sent, so only the canonical minified form is allowed.
    if (canonical !== body) {
      throw new Error("Il body firmato deve essere JSON minificato: usa JSON.stringify, non JSON.stringify(…, null, 2).");
    }
  }
  return `${timestamp}${input.method.toUpperCase()}${input.path}${query}${body}`;
}

/** Stable query string: sorted keys, no trailing separator, never a bare "?". */
export function serializeQuery(query?: Record<string, string | number | undefined>): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (value !== undefined) params.append(key, String(value));
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function assertRelativePath(path: string): string {
  const clean = path.trim();
  if (!clean.startsWith("/") || clean.includes("://")) {
    throw new Error(`Percorso Revolut X non valido: serve un path assoluto, ricevuto "${path}".`);
  }
  if (clean.includes("?") || clean.includes("#")) {
    throw new Error("Passa la query separatamente: il path non deve contenerla.");
  }
  if (clean.split("/").includes("..")) {
    throw new Error(`Percorso Revolut X non valido: "${path}" esce dalla radice dell'API.`);
  }
  return clean;
}
