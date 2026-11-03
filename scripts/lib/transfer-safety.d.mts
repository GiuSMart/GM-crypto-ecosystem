/**
 * Types for ./transfer-safety.mjs. The implementation is plain ESM so node can
 * run the scripts without a build step; tsc reads this file when the tests
 * import the module (allowJs is off, so a declaration is required).
 */
export declare function resolveBaseUrl(raw: string | null | undefined): string;

export declare const SNAPSHOT_FIELDS: Readonly<Record<string, string>>;

/** `row` is whatever came out of the snapshot file: validated at runtime. */
export declare function referralAdminBody(row: unknown): Record<string, unknown> & { action: string };

export declare function normaliseUrl(url: string): string;

export type StoredReferral = { id: string; url: string; active: number | boolean };

export type SnapshotRow = { id?: string | null; name?: string | null; url?: string | null; active?: unknown };

export type SnapshotCheck = {
  id: string | null;
  name: string;
  url: string;
  status: "pubblicata" | "spenta" | "assente" | "url" | "id" | "non-pubblicata" | "spenta-visibile";
  detail: string;
};

export declare function storedFor(catalogue: readonly StoredReferral[], row: SnapshotRow | null | undefined): StoredReferral | null;

export declare function compareSnapshot(
  rows: readonly SnapshotRow[],
  catalogue: readonly StoredReferral[],
  published: ReadonlyMap<string, string>,
): { total: number; public: number; inactive: number; problems: SnapshotCheck[]; results: SnapshotCheck[] };
