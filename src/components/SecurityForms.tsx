"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function PasswordChangeForm() {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setState(null);
    const res = await fetch("/api/auth/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ current, next }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    const ok = res.ok && json.ok !== false;
    setState({ ok, text: ok ? "Password aggiornata: tutte le altre sessioni sono state revocate." : json.error ?? "Errore." });
    if (ok) {
      setCurrent("");
      setNext("");
      router.refresh();
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-3 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="gm-label" htmlFor="p-cur">
            Password attuale
          </label>
          <input id="p-cur" className="gm-input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div>
          <label className="gm-label" htmlFor="p-new">
            Nuova password
          </label>
          <input id="p-new" className="gm-input" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="gm-btn-accent py-1.5 text-xs" disabled={busy}>
          {busy ? "Aggiornamento…" : "Cambia password"}
        </button>
        {state ? <span className={state.ok ? "text-[11px] text-pos" : "text-[11px] text-neg"}>{state.text}</span> : null}
      </div>
    </form>
  );
}

export function RevokeAllSessions() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    if (!window.confirm("Revocare tutte le sessioni? Dovrai effettuare di nuovo l'accesso.")) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/auth/sessions", { method: "DELETE" });
    if (res.ok) {
      router.push("/login");
      router.refresh();
      return;
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    setErr(json.error ?? "Revoca non riuscita.");
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-4">
      <button className="gm-btn py-1.5 text-xs" onClick={run} disabled={busy}>
        {busy ? "…" : "Revoca tutte le sessioni"}
      </button>
      {err ? <span className="text-[11px] text-neg">{err}</span> : null}
      <span className="text-[11px] text-muted">Chiude ogni accesso attivo, incluso questo.</span>
    </div>
  );
}
