import { createHash } from "node:crypto";
import type { SkillFileSnapshot } from "./types";

/** Snapshot paths are repository-relative, POSIX, and cannot escape the snapshot. */
const SAFE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\/\/)[\w.@+-]+(?:\/[\w.@+-]+)*$/;

export class SkillSnapshotError extends Error {}

/**
 * Deterministic SHA-256 of a Skill snapshot.
 *
 * The hash covers the path, the byte length and the exact content of every file,
 * sorted by path, so the same tree always produces the same value regardless of
 * the order the API returned the files in. Any content change produces a new
 * hash, which invalidates the previous source review.
 */
export function skillContentHash(files: readonly SkillFileSnapshot[]): string {
  if (files.length === 0) throw new SkillSnapshotError("snapshot vuoto: nessun file da hashare");

  const seen = new Set<string>();
  const entries = files.map((file) => {
    if (!file || typeof file.path !== "string" || !SAFE_PATH.test(file.path)) {
      throw new SkillSnapshotError(`percorso non valido nello snapshot: ${JSON.stringify(file?.path)}`);
    }
    if (typeof file.content !== "string") {
      throw new SkillSnapshotError(`contenuto non testuale per ${file.path}`);
    }
    if (seen.has(file.path)) throw new SkillSnapshotError(`file duplicato nello snapshot: ${file.path}`);
    seen.add(file.path);
    return file;
  });

  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const hash = createHash("sha256");
  hash.update("gm-skill-snapshot-v1\n");
  for (const entry of entries) {
    hash.update(`${entry.path}\n${Buffer.byteLength(entry.content, "utf8")}\n`);
    hash.update(entry.content, "utf8");
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}

/** True when a stored review hash still matches the current snapshot. */
export function snapshotUnchanged(reviewedHash: string, files: readonly SkillFileSnapshot[]): boolean {
  return reviewedHash === skillContentHash(files);
}
