"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function FeeForm({ venues, isAdmin }: { venues: { id: string; name: string; takerPct: number; makerPct: number }[]; isAdmin: boolean }) {
  const router = useRouter();
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const selected = venues.find((v) => v.id === venueId);
  const [maker, setMaker] = useState(selected?.makerPct ?? 0);
  const [taker, setTaker] = useState(selected?.takerPct ?? 0);
  const [note, setNote] = useState("");
  const [scope, setScope] = useState<"user" | "global">("user");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);

  const change = (id: string) => {
    setVenueId(id);
    const v = venues.find((x) => x.id === id);
    if (v) {
      setMaker(v.makerPct);
      setTaker(v.takerPct);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setState(null);
    const res = await fetch("/api/fees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venueId, makerPct: maker, takerPct: taker, note, scope }),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    const ok = res.ok && json.ok !== false;
    setState({ ok, text: ok ? "Override salvato: il motore userà questi valori." : json.error ?? "Errore." });
    if (ok) router.refresh();
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-3 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="gm-label" htmlFor="f-venue">
            Venue
          </label>
          <select id="f-venue" className="gm-input" value={venueId} onChange={(e) => change(e.target.value)}>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="gm-label" htmlFor="f-maker">
            Maker %
          </label>
          <input id="f-maker" className="gm-input num" type="number" step="0.01" min="0" max="5" value={maker} onChange={(e) => setMaker(Number(e.target.value))} />
        </div>
        <div>
          <label className="gm-label" htmlFor="f-taker">
            Taker %
          </label>
          <input id="f-taker" className="gm-input num" type="number" step="0.01" min="0" max="5" value={taker} onChange={(e) => setTaker(Number(e.target.value))} />
        </div>
        <div>
          <label className="gm-label" htmlFor="f-note">
            Nota (tier, fonte)
          </label>
          <input id="f-note" className="gm-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Es. Tier PRO 0.16% taker" />
        </div>
      </div>
      {isAdmin ? (
        <label className="flex items-center gap-2 text-[11px] text-muted">
          <input type="checkbox" checked={scope === "global"} onChange={(e) => setScope(e.target.checked ? "global" : "user")} />
          Applica come default globale (tutti i tenant)
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="gm-btn-accent py-1.5 text-xs" disabled={busy}>
          {busy ? "Salvataggio…" : "Salva override"}
        </button>
        {state ? <span className={state.ok ? "text-[11px] text-pos" : "text-[11px] text-neg"}>{state.text}</span> : null}
      </div>
    </form>
  );
}
