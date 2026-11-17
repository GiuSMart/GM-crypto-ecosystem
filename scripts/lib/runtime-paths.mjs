import path from "node:path";

/** Keep operator scripts aligned with src/lib/paths.ts. */
export function dataDir() {
  return process.env.GM_DATA_DIR ?? path.join(process.cwd(), "data");
}

export function dbFile() {
  return process.env.GM_DB_PATH ?? path.join(dataDir(), "gm.db");
}
