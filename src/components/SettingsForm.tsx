"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { EngineSettings } from "@/lib/config";

type Branding = { appName: string; logoMark: string; accent: string; tagline: string; footer: string };
type NetworkFees = Record<string, { feeInBase: number | null; source: string }>;

export default function SettingsForm({
  settings,
  networkFees,
  assets,
  role,
  brandName,
  brandAccent,
  globalBranding,
}: {
  settings: EngineSettings;
  networkFees: NetworkFees;
  assets: readonly string[];
  role: "admin" | "client";
  brandName: string | null;
  brandAccent: string | null;
  globalBranding: Branding;
}) {
  const router = useRouter();
  const [form, setForm] = useState<EngineSettings>(settings);
  const [fees, setFees] = useState<Record<string, string>>(
    Object.fromEntries(assets.map((a) => [a, networkFees[a]?.feeInBase != null ? String(networkFees[a].feeInBase) : ""])),
  );
  const [brand, setBrand] = useState({ brandName: brandName ?? "", brandAccent: brandAccent ?? "" });
  const [global, setGlobal] = useState(globalBranding);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);

  const set = <K extends keyof EngineSettings,>(key: K, value: EngineSettings[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setState(null);
    const body: Record<string, unknown> = {
      ...form,
      brandName: brand.brandName || null,
      brandAccent: brand.brandAccent || null,
      networkFees: Object.fromEntries(assets.map((a) => [a, fees[a] === "" ? null : Number(fees[a])])),
    };
    if (role === "admin") body.globalBranding = global;

    const res = await fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    setState({ ok: res.ok && json.ok !== false, text: res.ok ? "Impostazioni salvate." : json.error ?? "Errore di salvataggio." });
    if (res.ok) router.refresh();
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-5 px-4 py-4">
      <fieldset className="space-y-3">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">Motore di arbitraggio</legend>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Margine netto minimo (%)" hint="Sotto questa soglia il segnale non è eseguibile.">
            <input className="gm-input num" type="number" step="0.05" min="0" max="50" value={form.minMarginPct} onChange={(e) => set("minMarginPct", Number(e.target.value))} />
          </Field>
          <Field label="Notional per operazione" hint="Capitale in valuta di quotazione per ogni gamba.">
            <input className="gm-input num" type="number" step="10" min="10" value={form.notionalQuote} onChange={(e) => set("notionalQuote", Number(e.target.value))} />
          </Field>
          <Field label="Slippage massimo tollerato (%)" hint="Calcolato sul VWAP di profondità, non sul top of book.">
            <input className="gm-input num" type="number" step="0.05" min="0" max="10" value={form.maxSlippagePct} onChange={(e) => set("maxSlippagePct", Number(e.target.value))} />
          </Field>
          <Field label="Buffer di sicurezza (%)" hint="Haircut prudenziale sui proventi.">
            <input className="gm-input num" type="number" step="0.01" min="0" max="5" value={form.safetyBufferPct} onChange={(e) => set("safetyBufferPct", Number(e.target.value))} />
          </Field>
          <Field label="Spread candidato minimo (%)" hint="Soglia per spendere rate limit sugli order book.">
            <input className="gm-input num" type="number" step="0.05" min="0" max="10" value={form.candidateSpreadPct} onChange={(e) => set("candidateSpreadPct", Number(e.target.value))} />
          </Field>
          <Field label="Età massima dati (ms)" hint="Dati più vecchi non sono eseguibili.">
            <input className="gm-input num" type="number" step="1000" min="500" max="300000" value={form.maxDataAgeMs} onChange={(e) => set("maxDataAgeMs", Number(e.target.value))} />
          </Field>
          <Field label="Valuta di quotazione">
            <select className="gm-input" value={form.quote} onChange={(e) => set("quote", e.target.value as EngineSettings["quote"])}>
              <option value="USD">USD</option>
              <option value="EUR">EUR</option>
            </select>
          </Field>
          <Field label="Modalità trasferimento" hint="Prefunded: inventario su entrambe le venue.">
            <select className="gm-input" value={form.transferMode} onChange={(e) => set("transferMode", e.target.value as EngineSettings["transferMode"])}>
              <option value="prefunded">Prefunded (nessun trasferimento)</option>
              <option value="transfer">Transfer (fee di rete incluse)</option>
            </select>
          </Field>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          <Toggle label="Monitoraggio attivo" checked={form.monitoringEnabled} onChange={(v) => set("monitoringEnabled", v)} />
          <Toggle label="Paper trading automatico" checked={form.paperAutoFollow} onChange={(v) => set("paperAutoFollow", v)} />
          <Toggle
            label="Live trading (solo admin)"
            checked={form.liveTradingEnabled}
            onChange={(v) => set("liveTradingEnabled", v)}
            disabled={role !== "admin"}
            hint={role === "admin" ? "Non basta: serve anche l'autorizzazione per utente." : "Solo l'amministratore può abilitarlo."}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t pt-4" style={{ borderColor: "var(--color-line)" }}>
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">Limiti di rischio</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Capitale massimo per ordine">
            <input className="gm-input num" type="number" min="0" step="50" value={form.maxOrderQuote} onChange={(e) => set("maxOrderQuote", Number(e.target.value))} />
          </Field>
          <Field label="Perdita massima giornaliera">
            <input className="gm-input num" type="number" min="0" step="10" value={form.maxDailyLossQuote} onChange={(e) => set("maxDailyLossQuote", Number(e.target.value))} />
          </Field>
          <Field label="Ordini massimi per ora">
            <input className="gm-input num" type="number" min="0" step="1" value={form.maxOrdersPerHour} onChange={(e) => set("maxOrdersPerHour", Number(e.target.value))} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t pt-4" style={{ borderColor: "var(--color-line)" }}>
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">Fee di rete per asset (unità dell&apos;asset)</legend>
        <p className="text-[11px] leading-relaxed text-muted">
          Lasciare vuoto = costo non configurato. In modalità transfer questo blocca i segnali: preferiamo zero operazioni a un profitto stimato su un costo inventato.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {assets.map((asset) => (
            <div key={asset}>
              <label className="gm-label" htmlFor={`fee-${asset}`}>
                {asset}
              </label>
              <input
                id={`fee-${asset}`}
                className="gm-input num"
                type="number"
                step="0.00000001"
                min="0"
                value={fees[asset] ?? ""}
                placeholder="non configurato"
                onChange={(e) => setFees((f) => ({ ...f, [asset]: e.target.value }))}
              />
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t pt-4" style={{ borderColor: "var(--color-line)" }}>
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-gold">White-label (il tuo brand)</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome brand personale">
            <input className="gm-input" value={brand.brandName} onChange={(e) => setBrand((b) => ({ ...b, brandName: e.target.value }))} placeholder={globalBranding.appName} />
          </Field>
          <Field label="Colore accento (hex)">
            <input className="gm-input" value={brand.brandAccent} onChange={(e) => setBrand((b) => ({ ...b, brandAccent: e.target.value }))} placeholder="#d4af37" />
          </Field>
        </div>
        {role === "admin" ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Nome applicazione (globale)">
              <input className="gm-input" value={global.appName} onChange={(e) => setGlobal((g) => ({ ...g, appName: e.target.value }))} />
            </Field>
            <Field label="Logo mark (max 4 caratteri)">
              <input className="gm-input" maxLength={4} value={global.logoMark} onChange={(e) => setGlobal((g) => ({ ...g, logoMark: e.target.value }))} />
            </Field>
            <Field label="Accento globale">
              <input className="gm-input" value={global.accent} onChange={(e) => setGlobal((g) => ({ ...g, accent: e.target.value }))} />
            </Field>
            <Field label="Tagline">
              <input className="gm-input" value={global.tagline} onChange={(e) => setGlobal((g) => ({ ...g, tagline: e.target.value }))} />
            </Field>
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t pt-4" style={{ borderColor: "var(--color-line)" }}>
        <button type="submit" className="gm-btn-accent" disabled={busy}>
          {busy ? "Salvataggio…" : "Salva impostazioni"}
        </button>
        {state ? <span className={state.ok ? "text-xs text-pos" : "text-xs text-neg"}>{state.text}</span> : null}
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="gm-label">{label}</label>
      {children}
      {hint ? <p className="mt-1 text-[10px] leading-snug text-[#686873]">{hint}</p> : null}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label
      className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs"
      style={{ borderColor: "var(--color-line)", opacity: disabled ? 0.55 : 1 }}
      title={hint}
    >
      <input type="checkbox" className="mt-0.5" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="block font-medium text-paper">{label}</span>
        {hint ? <span className="mt-0.5 block text-[10px] leading-snug text-muted">{hint}</span> : null}
      </span>
    </label>
  );
}
