/**
 * Resolve the client address used for rate limiting and audit records.
 *
 * Both `x-real-ip` and `x-forwarded-for` arrive from the network, and a caller
 * can send its own copy of either one. `x-forwarded-for` is a list that each
 * proxy *appends* to, so its leftmost entry is whatever the caller claimed:
 * trusting that (as this app used to) lets one attacker put a different value in
 * every request and receive a fresh login bucket each time, which defeats the
 * brute-force lockout entirely.
 *
 * So we prefer the single-valued `x-real-ip` that a reverse proxy overwrites,
 * and otherwise take the rightmost forwarded hop — the address added by the
 * closest proxy. Values that do not parse as an address are skipped rather than
 * recorded, so junk cannot reach the audit trail.
 */

export type HeaderReader = (name: string) => string | null | undefined;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-f:]+$/i;

/** Strip the decorations proxies add: quotes, brackets, ports, zone ids. */
function normalize(raw: string): string | null {
  let value = raw.trim().replace(/^"|"$/g, "");
  if (!value || value.length > 64) return null;

  // [2001:db8::1]:443 or [2001:db8::1]
  const bracketed = /^\[([^\]]+)\](?::\d{1,5})?$/.exec(value);
  if (bracketed) value = bracketed[1];
  else {
    // 203.0.113.7:51234 — an IPv6 address has several colons, so only strip a
    // single trailing port from something that otherwise looks like IPv4.
    const v4 = /^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/.exec(value);
    if (v4) value = v4[1];
  }

  const zone = value.indexOf("%");
  if (zone > 0) value = value.slice(0, zone);

  if (!IPV4.test(value) && !(value.includes(":") && IPV6.test(value))) return null;

  const v4 = IPV4.exec(value);
  if (v4 && v4.slice(1).some((octet) => Number(octet) > 255)) return null;

  return value.toLowerCase();
}

/**
 * Pure and testable: the caller supplies header access, so this works with
 * `next/headers` in a request scope and with a plain map in tests.
 */
export function resolveClientIp(getHeader: HeaderReader): string {
  const realIp = getHeader("x-real-ip");
  if (realIp) {
    const parsed = normalize(realIp);
    // A proxy that sets x-real-ip sends exactly one address; anything else is
    // malformed or forged, so fall through to the forwarded chain.
    if (parsed && !realIp.includes(",")) return parsed;
  }

  const forwarded = getHeader("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((hop) => hop.trim()).filter(Boolean);
    for (let i = hops.length - 1; i >= 0; i -= 1) {
      const parsed = normalize(hops[i]);
      if (parsed) return parsed;
    }
  }

  return "local";
}
