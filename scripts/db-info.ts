/**
 * Read-only database report: `npm run db:info`
 *
 * Opens the SQLite file in read-only mode, so it never seeds, migrates or writes
 * anything. Secrets are never printed: no password hashes, API keys or session
 * tokens — only table names, row counts, file metadata and integrity state.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const file =
  process.env.GM_DB_PATH ??
  path.join(process.env.GM_DATA_DIR ?? path.join(process.cwd(), "data"), "gm.db");

if (!fs.existsSync(file)) {
  console.error(
    `Database non trovato: ${file}\n` +
      "Avvia l'applicazione una volta (npm run dev) per crearlo, oppure imposta GM_DB_PATH.",
  );
  process.exitCode = 1;
} else {
  const stat = fs.statSync(file);
  let db: DatabaseSync | undefined;

  try {
    db = new DatabaseSync(file, { readOnly: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    const journal = db.prepare("PRAGMA journal_mode").get() as { journal_mode?: string } | undefined;

    console.log("GM CRYPTO ARBITRAGE AI — report database (sola lettura)");
    console.log(`  file:         ${file}`);
    console.log(`  dimensione:   ${(stat.size / 1024).toFixed(1)} KB`);
    console.log(`  permessi:     ${(stat.mode & 0o777).toString(8)}`);
    console.log(`  journal_mode: ${journal?.journal_mode ?? "n/d"}`);
    console.log(`  integrità:    ${integrity?.integrity_check ?? "n/d"}`);
    console.log(`\ntabelle (${tables.length}):`);

    for (const { name } of tables) {
      // Table names come from sqlite_master; the identifier is quoted anyway.
      const row = db.prepare(`SELECT COUNT(*) AS n FROM "${name.replace(/"/g, '""')}"`).get() as
        | { n: number }
        | undefined;
      console.log(`  ${name.padEnd(22)}${String(row?.n ?? 0).padStart(8)}`);
    }
  } catch (error) {
    console.error(`Lettura non riuscita: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    db?.close();
  }
}
