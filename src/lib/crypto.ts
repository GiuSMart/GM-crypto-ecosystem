import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths";

/* -------------------------------------------------------------------------- */
/* Passwords                                                                   */
/* -------------------------------------------------------------------------- */

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

/** scrypt hash, self-describing so parameters can be rotated later. */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEY_LEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(stored: string, password: string): boolean {
  try {
    const [alg, n, r, p, saltHex, hashHex] = stored.split("$");
    if (alg !== "scrypt") return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export const PASSWORD_MIN_LENGTH = 10;

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < PASSWORD_MIN_LENGTH) problems.push(`almeno ${PASSWORD_MIN_LENGTH} caratteri`);
  if (!/[a-z]/.test(password)) problems.push("una minuscola");
  if (!/[A-Z]/.test(password)) problems.push("una maiuscola");
  if (!/[0-9]/.test(password)) problems.push("un numero");
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Tokens                                                                      */
/* -------------------------------------------------------------------------- */

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const sha256hex = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
export const newId = (prefix: string) => `${prefix}_${crypto.randomBytes(9).toString("hex")}`;
export const constantTimeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
};

/* -------------------------------------------------------------------------- */
/* Symmetric encryption for exchange API credentials (AES-256-GCM)              */
/* -------------------------------------------------------------------------- */

let cachedKey: Buffer | null = null;

/**
 * Master key resolution order:
 *   1. GM_ENCRYPTION_KEY (base64, 32 bytes) — recommended for hosted deployments.
 *   2. data/master.key — generated once with 0600 permissions for local installs.
 * The key never leaves the server process and is never logged.
 */
function masterKey(): Buffer {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.GM_ENCRYPTION_KEY;
  if (fromEnv) {
    const key = Buffer.from(fromEnv, "base64");
    if (key.length !== 32) throw new Error("GM_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
    cachedKey = key;
    return key;
  }
  const file = path.join(dataDir(), "master.key");
  if (fs.existsSync(file)) {
    const key = Buffer.from(fs.readFileSync(file, "utf8").trim(), "base64");
    if (key.length !== 32) throw new Error("data/master.key is corrupted (expected 32 bytes)");
    cachedKey = key;
    return key;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString("base64"), { mode: 0o600 });
  cachedKey = key;
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decryptSecret(blob: string): string {
  const [version, ivB64, tagB64, ctB64] = blob.split(".");
  if (version !== "v1") throw new Error("unsupported secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** Never show a stored credential: only a masked suffix. */
export const maskSecret = (plainOrNull: string | null | undefined) =>
  plainOrNull ? `••••${plainOrNull.slice(-4)}` : "—";
