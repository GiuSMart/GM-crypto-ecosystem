"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ScanResponse = {
  ok?: boolean;
  error?: string;
  data?: { candidates: number; executable: number; durationMs: number; pairsScanned: number };
};

/**
 * Runs scans only while the authenticated dashboard is open and visible.
 * A server scheduler is required for unattended 24/7 monitoring.
 */
export default function MonitorRunner({
  enabled,
  intervalMs,
}: {
  enabled: boolean;
  intervalMs: number;
}) {
  const router = useRouter();
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped) return;

      if (document.visibilityState !== "visible") {
        timer = setTimeout(tick, intervalMs);
        return;
      }

      try {
        const response = await fetch("/api/scan", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const result = (await response.json().catch(() => ({}))) as ScanResponse;

        if (!response.ok || result.ok === false || !result.data) {
          throw new Error(result.error ?? `Scansione automatica non riuscita (HTTP ${response.status}).`);
        }

        if (stopped) return;
        const data = result.data;
        setLastRun(new Date().toLocaleTimeString());
        setMessage(`${data.pairsScanned} coppie · ${data.candidates} candidati · ${data.executable} eseguibili`);
        setError(null);
        router.refresh();
      } catch (err) {
        if (!stopped) setError((err as Error).message);
      } finally {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      }
    };

    timer = setTimeout(tick, intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, intervalMs, router]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--color-line)] bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${enabled ? "bg-pos" : "bg-muted"}`} />
        <div>
          <div className="text-[11px] font-semibold text-paper">
            {enabled ? `Monitoraggio automatico · ogni ${Math.round(intervalMs / 1000)}s` : "Monitoraggio automatico in pausa"}
          </div>
          <div className="text-[10px] text-muted">
            {enabled
              ? lastRun
                ? `Ultima scansione ${lastRun} · ${message}`
                : "La scansione parte al prossimo intervallo, se la pagina è visibile."
              : "Riattivalo da Impostazioni per riprendere le scansioni."}
          </div>
        </div>
      </div>
      {error ? <span className="max-w-full text-[10px] text-warn">{error}</span> : null}
    </div>
  );
}
