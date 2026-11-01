import path from "node:path";
import fs from "node:fs";

/** Absolute path to the writable runtime data directory (SQLite db + master key). */
export function dataDir(): string {
  const dir = process.env.GM_DATA_DIR ?? path.join(process.cwd(), "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function dbFile(): string {
  return process.env.GM_DB_PATH ?? path.join(dataDir(), "gm.db");
}

export const isProduction = () => process.env.NODE_ENV === "production";
