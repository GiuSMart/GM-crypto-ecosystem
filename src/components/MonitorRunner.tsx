"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { isAlertCooldownComplete, verifiedSignalAlerts, type AlertCandidate } from "@/lib/engine/signal-alerts";

type ScanResponse = {
  ok?: boolean;
  error?: string;
  data?: {
    candidates: number;
    executable: number;
    durationMs: number;
    pairsScanned: number;
    evaluations?: AlertCandidate[];
  };
};

const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Runs scans and optional browser notifications only while the authenticated
 * dashboard is open and visible. A server scheduler + push service is required
 * for unattended 24/7 alerts.
 */
export default function MonitorRunner({
  enabled,
  intervalMs,
  userId,
}: {
  enabled: boolean;
  intervalMs: number;
  userId: string;
}) {
  const router = useRouter();
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">("default");

  const preferenceKey = `gm-alerts-enabled:${userId}`;
  const cooldownKey = `gm-alerts-last-sent:${userId}`;

  useEffect(() => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }
    setNotificationPermission(Notification.permission);
    try {
      setNotificationsEnabled(
        localStorage.getItem(preferenceKey) === "1" && Notification.permission === "granted",
      );
    } catch {
      setNotificationsEnabled(false);
    }
  }, [preferenceKey]);

  const enableNotifications = async () => {
    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      setError("Questo browser non supporta le notifiche.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      const allowed = permission === "granted";
      setNotificationsEnabled(allowed);
      localStorage.setItem(preferenceKey, allowed ? "1" : "0");
      setError(allowed ? null : "Permesso notifiche non concesso dal browser.");
    } catch {
      setError("Impossibile attivare le notifiche in questo browser.");
    }
  };

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

        if (notificationsEnabled && "Notification" in window && Notification.permission === "granted") {
          const alerts = verifiedSignalAlerts(data.evaluations ?? []);
          let lastSent: Record<string, number> = {};
          try {
            lastSent = JSON.parse(localStorage.getItem(cooldownKey) ?? "{}") as Record<string, number>;
          } catch {
            lastSent = {};
          }

          let changed = false;
          for (const signal of alerts) {
            const previous = Number(lastSent[signal.key]);
            const lastAt = Number.isFinite(previous) ? previous : null;
            const now = Date.now();
            if (!isAlertCooldownComplete(lastAt, now, ALERT_COOLDOWN_MS)) continue;

            const notification = new Notification(`GM Intelligence · ${signal.pair}`, {
              body: `Netto stimato ${signal.netProfit.toFixed(2)} ${data.quote} · margine ${signal.marginPct.toFixed(3)}%\n${signal.buyVenue} → ${signal.sellVenue}`,
              tag: signal.key,
              renotify: false,
            });
            notification.onclick = () => window.focus();
            lastSent[signal.key] = now;
            changed = true;
          }
          if (changed) {
            try {
              localStorage.setItem(cooldownKey, JSON.stringify(lastSent));
            } catch {
              // Notifications remain useful even if browser storage is unavailable.
            }
          }
        }
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
  }, [enabled, intervalMs, notificationsEnabled, cooldownKey, router]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-line)] bg-white/[0.02] px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${enabled ? "bg-pos" : "bg-muted"}`} />
        <div className="min-w-0">
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
          {notificationsEnabled ? (
            <div className="mt-1 text-[10px] text-pos">Avvisi attivi · solo segnali eseguibili con netto positivo · pausa di 15 minuti per rotta</div>
          ) : null}
          {notificationPermission === "denied" ? (
            <div className="mt-1 text-[10px] text-muted">Notifiche bloccate nelle autorizzazioni del browser.</div>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {notificationPermission !== "unsupported" ? (
          <button type="button" className="gm-btn text-[10px]" onClick={enableNotifications} disabled={notificationsEnabled}>
            {notificationsEnabled ? "Notifiche attive" : "Attiva notifiche"}
          </button>
        ) : null}
        {error ? <span className="max-w-full text-[10px] text-warn">{error}</span> : null}
      </div>
    </div>
  );
}
