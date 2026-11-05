/**
 * Credential redaction shared by the gateway and provider adapters.
 *
 * Provider errors are the most likely place for a key to leak: aggregators often
 * echo the rejected header back. Everything written to an audit sink or returned
 * in a typed failure passes through here first.
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/sk-[A-Za-z0-9_-]{8,}/g, "[redacted-key]"],
  [/hf_[A-Za-z0-9]{8,}/g, "[redacted-key]"],
  [/AIza[0-9A-Za-z_-]{20,}/g, "[redacted-key]"],
  [/Bearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer [redacted]"],
];

export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}
