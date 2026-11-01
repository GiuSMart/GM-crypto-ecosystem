export const DEFAULT_WORKER_INTERVAL_MS = 60_000;
export const MIN_WORKER_INTERVAL_MS = 30_000;
export const MAX_WORKER_INTERVAL_MS = 60 * 60 * 1000;

/** Worker activation is deliberately opt-in; unset/invalid values stay disabled. */
export function isWorkerEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "true";
}

/** Accept only bounded integer intervals; invalid input falls back safely. */
export function workerIntervalMs(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value.trim())) return DEFAULT_WORKER_INTERVAL_MS;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return DEFAULT_WORKER_INTERVAL_MS;
  return Math.min(MAX_WORKER_INTERVAL_MS, Math.max(MIN_WORKER_INTERVAL_MS, parsed));
}
