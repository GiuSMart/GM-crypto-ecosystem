"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

async function call(url: string, body?: unknown, method = "POST") {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
    return {
      ok: res.ok && json.ok !== false,
      error: json.error ?? (res.ok ? undefined : `Errore HTTP ${res.status}`),
      data: json.data ?? null,
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message, data: null };
  }
}

export function ScanButton({ label = "Avvia scansione" }: { label?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    const r = await call("/api/scan");
    if (!r.ok) {
      setErr(r.error ?? "Scansione non riuscita.");
    } else {
      const d = r.data as { candidates: number; executable: number; durationMs: number; pairsScanned: number };
      setMsg(`${d.pairsScanned} coppie · ${d.candidates} candidati · ${d.executable} eseguibili · ${Math.round(d.durationMs / 1000)}s`);
      router.refresh();
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button className="gm-btn-accent" onClick={run} disabled={busy} title="Legge gli order book pubblici ed esegue il motore">
        <Icon name={busy ? "refresh" : "bolt"} size={16} className={busy ? "animate-spin" : undefined} />
        {busy ? "Scansione…" : label}
      </button>
      {msg ? <span className="text-[11px] text-pos">{msg}</span> : null}
      {err ? <span className="max-w-xs text-[11px] text-neg">{err}</span> : null}
    </div>
  );
}

export function OpenPaperButton({ opportunityId, disabled }: { opportunityId: string; disabled?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    const r = await call("/api/paper/trades", { opportunityId });
    if (!r.ok) setErr(r.error ?? "Apertura non riuscita.");
    else router.refresh();
    setBusy(false);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button className="gm-btn px-2.5 py-1 text-xs" onClick={run} disabled={busy || disabled} title={disabled ? "Solo i segnali eseguibili possono diventare paper trade" : "Apri una simulazione"}>
        {busy ? "…" : "Paper"}
      </button>
      {err ? <span className="max-w-[180px] text-right text-[10px] leading-tight text-neg">{err}</span> : null}
    </div>
  );
}

export function CloseTradeButton({ tradeId }: { tradeId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setErr(null);
    const r = await call(`/api/paper/trades/${tradeId}`, {});
    if (!r.ok) setErr(r.error ?? "Chiusura non riuscita.");
    else router.refresh();
    setBusy(false);
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button className="gm-btn px-2.5 py-1 text-xs" onClick={run} disabled={busy}>
        {busy ? "…" : "Chiudi"}
      </button>
      {err ? <span className="max-w-[180px] text-right text-[10px] leading-tight text-neg">{err}</span> : null}
    </div>
  );
}

export function Mutate({
  url,
  body,
  method = "POST",
  label,
  icon,
  variant = "default",
  confirmText,
  successText,
  disabled,
  children,
}: {
  url: string;
  body?: unknown;
  method?: string;
  label: string;
  icon?: IconName;
  variant?: "default" | "accent" | "ghost";
  confirmText?: string;
  successText?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const run = async () => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setState(null);
    const r = await call(url, body, method);
    setState({ kind: r.ok ? "ok" : "err", text: r.ok ? successText ?? "Fatto." : r.error ?? "Operazione non riuscita." });
    if (r.ok) router.refresh();
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        className={variant === "accent" ? "gm-btn-accent py-1.5 text-xs" : variant === "ghost" ? "gm-btn-ghost" : "gm-btn py-1.5 text-xs"}
        onClick={run}
        disabled={busy || disabled}
        type="button"
      >
        {icon ? <Icon name={icon} size={14} /> : null}
        {busy ? "…" : label}
      </button>
      {children}
      {state ? <span className={state.kind === "ok" ? "text-[11px] text-pos" : "text-[11px] text-neg"}>{state.text}</span> : null}
    </div>
  );
}
