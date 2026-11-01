"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const admin = async (body: Record<string, unknown>) => {
  const res = await fetch("/api/admin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  return { ok: res.ok && json.ok !== false, error: json.error };
};

type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  plan: string;
  status: string;
  created_at: string;
  last_login_at: string | null;
  live_authorized: number;
};

export function AdminUserControls({ user, plans }: { user: AdminUser; plans: { id: string; name: string }[] }) {
  const router = useRouter();
  const [plan, setPlan] = useState(user.plan);
  const [maxOrder, setMaxOrder] = useState(100);
  const [maxLoss, setMaxLoss] = useState(25);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (body: Record<string, unknown>, okText: string) => {
    setBusy(true);
    setState(null);
    const r = await admin(body);
    setState({ ok: r.ok, text: r.ok ? okText : r.error ?? "Errore." });
    if (r.ok) router.refresh();
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select className="gm-input w-auto py-1 text-xs" value={plan} onChange={(e) => setPlan(e.target.value)} disabled={busy}>
        {plans.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button className="gm-btn px-2 py-1 text-[11px]" disabled={busy} onClick={() => run({ action: "assign_plan", userId: user.id, planId: plan }, "Piano aggiornato.")}>
        Piano
      </button>
      <button
        className="gm-btn px-2 py-1 text-[11px]"
        disabled={busy}
        onClick={() => run({ action: "set_role", userId: user.id, role: user.role === "admin" ? "client" : "admin" }, "Ruolo aggiornato.")}
      >
        {user.role === "admin" ? "Rendi client" : "Rendi admin"}
      </button>
      <button
        className="gm-btn px-2 py-1 text-[11px]"
        disabled={busy}
        onClick={() =>
          run({ action: "set_status", userId: user.id, status: user.status === "active" ? "suspended" : "active" }, "Stato aggiornato.")
        }
      >
        {user.status === "active" ? "Sospendi" : "Riattiva"}
      </button>

      <span className="mx-1 h-4 w-px bg-[var(--color-line)]" />

      {user.live_authorized ? (
        <button className="gm-btn px-2 py-1 text-[11px] text-warn" disabled={busy} onClick={() => run({ action: "revoke_live", userId: user.id }, "Autorizzazione revocata.")}>
          Revoca live
        </button>
      ) : (
        <>
          <input
            className="gm-input w-20 py-1 text-[11px]"
            type="number"
            min="0"
            value={maxOrder}
            onChange={(e) => setMaxOrder(Number(e.target.value))}
            title="Capitale massimo per ordine"
          />
          <input
            className="gm-input w-20 py-1 text-[11px]"
            type="number"
            min="0"
            value={maxLoss}
            onChange={(e) => setMaxLoss(Number(e.target.value))}
            title="Perdita massima giornaliera"
          />
          <button
            className="gm-btn px-2 py-1 text-[11px]"
            disabled={busy}
            onClick={() =>
              run(
                { action: "grant_live", userId: user.id, maxOrderQuote: maxOrder, maxDailyLossQuote: maxLoss, confirm: true, note: "Autorizzazione manuale admin" },
                "Live autorizzato (router comunque non implementato).",
              )
            }
          >
            Autorizza live
          </button>
        </>
      )}
      {state ? <span className={state.ok ? "text-[10px] text-pos" : "text-[10px] text-neg"}>{state.text}</span> : null}
    </div>
  );
}

export function PlanPriceRow({ plan }: { plan: { id: string; name: string; price_cents: number; currency: string; payments_configured: number } }) {
  const router = useRouter();
  const [value, setValue] = useState((plan.price_cents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    const r = await admin({ action: "set_plan_price", planId: plan.id, priceCents: Math.round(Number(value) * 100) });
    setMsg(r.ok ? "Prezzo aggiornato." : r.error ?? "Errore.");
    if (r.ok) router.refresh();
    setBusy(false);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-20 text-xs font-semibold text-paper">{plan.name}</span>
      <input className="gm-input w-24 py-1 text-xs num" type="number" min="0" step="1" value={value} onChange={(e) => setValue(e.target.value)} />
      <span className="text-[11px] text-muted">{plan.currency}/mese</span>
      <button className="gm-btn px-2 py-1 text-[11px]" onClick={save} disabled={busy}>
        Salva
      </button>
      <span className="gm-badge">{plan.payments_configured ? "pagamenti attivi" : "pagamenti off"}</span>
      {msg ? <span className="text-[10px] text-muted">{msg}</span> : null}
    </div>
  );
}

export function ReferralForm({
  initial,
}: {
  initial?: {
    id: string;
    platform: string;
    name: string;
    url: string;
    tagline: string | null;
    description: string | null;
    how_it_works: string | null;
    terms: string | null;
    rewards: string | null;
    verified: number;
    active: number;
  };
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    id: initial?.id ?? "",
    platform: initial?.platform ?? "",
    name: initial?.name ?? "",
    url: initial?.url ?? "",
    tagline: initial?.tagline ?? "",
    description: initial?.description ?? "",
    howItWorks: initial?.how_it_works ?? "",
    terms: initial?.terms ?? "",
    rewards: initial?.rewards ?? "",
    verified: Boolean(initial?.verified),
    active: initial ? Boolean(initial.active) : true,
  });
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setState(null);
    const r = await admin({ action: "upsert_referral", ...form, id: form.id || undefined });
    setState({ ok: r.ok, text: r.ok ? "Referral salvato." : r.error ?? "Errore." });
    if (r.ok) router.refresh();
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-2 px-4 py-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="gm-input text-xs" placeholder="Piattaforma" value={form.platform} onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))} required />
        <input className="gm-input text-xs" placeholder="Nome" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
      </div>
      <input className="gm-input text-xs" placeholder="https://link-referral" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} required />
      <input className="gm-input text-xs" placeholder="Tagline" value={form.tagline} onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))} />
      <textarea className="gm-input text-xs" rows={2} placeholder="Descrizione" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      <textarea className="gm-input text-xs" rows={2} placeholder="Come funziona" value={form.howItWorks} onChange={(e) => setForm((f) => ({ ...f, howItWorks: e.target.value }))} />
      <div className="grid gap-2 sm:grid-cols-2">
        <input className="gm-input text-xs" placeholder="Condizioni" value={form.terms} onChange={(e) => setForm((f) => ({ ...f, terms: e.target.value }))} />
        <input className="gm-input text-xs" placeholder="Ricompense (solo se verificate)" value={form.rewards} onChange={(e) => setForm((f) => ({ ...f, rewards: e.target.value }))} />
      </div>
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={form.verified} onChange={(e) => setForm((f) => ({ ...f, verified: e.target.checked }))} /> verificato
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} /> attivo
        </label>
        <button type="submit" className="gm-btn-accent ml-auto py-1.5 text-xs" disabled={busy}>
          {busy ? "…" : "Salva referral"}
        </button>
        {state ? <span className={state.ok ? "text-pos" : "text-neg"}>{state.text}</span> : null}
      </div>
    </form>
  );
}
