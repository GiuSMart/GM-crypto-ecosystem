"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const post = async (url: string, body: unknown) => {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  return { ok: res.ok && json.ok !== false, error: json.error };
};

export function WalletForm({ platforms }: { platforms: { id: string; name: string }[] }) {
  const router = useRouter();
  const [platform, setPlatform] = useState(platforms[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [address, setAddress] = useState("");
  const [chain, setChain] = useState("");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setState(null);
    const r = await post("/api/wallets", { platform, label, address, chain });
    setState({ ok: r.ok, text: r.ok ? "Wallet aggiunto in sola lettura." : r.error ?? "Errore." });
    if (r.ok) {
      setLabel("");
      setAddress("");
      setChain("");
      router.refresh();
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-3 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="gm-label" htmlFor="w-platform">
            Piattaforma
          </label>
          <select id="w-platform" className="gm-input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {platforms.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="gm-label" htmlFor="w-label">
            Nome wallet
          </label>
          <input id="w-label" className="gm-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Es. Phantom principale" />
        </div>
      </div>
      <div>
        <label className="gm-label" htmlFor="w-address">
          Indirizzo pubblico
        </label>
        <input id="w-address" className="gm-input font-mono text-xs" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Solo indirizzo pubblico — mai la seed phrase" />
      </div>
      <div>
        <label className="gm-label" htmlFor="w-chain">
          Rete (opzionale)
        </label>
        <input id="w-chain" className="gm-input" value={chain} onChange={(e) => setChain(e.target.value)} placeholder="Solana, Ethereum, Bitcoin…" />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="gm-btn-accent py-1.5 text-xs" disabled={busy}>
          {busy ? "Salvataggio…" : "Aggiungi wallet"}
        </button>
        {state ? <span className={state.ok ? "text-[11px] text-pos" : "text-[11px] text-neg"}>{state.text}</span> : null}
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        Il collegamento è di sola lettura: memorizziamo l&apos;indirizzo pubblico, non chiavi. Qualsiasi richiesta di seed phrase è una truffa.
      </p>
    </form>
  );
}

export function CredentialForm({ venues }: { venues: { id: string; name: string }[] }) {
  const router = useRouter();
  const [venueId, setVenueId] = useState(venues[0]?.id ?? "");
  const [label, setLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");
  const [confirmReadOnly, setConfirmReadOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setState(null);
    const r = await post("/api/credentials", { venueId, label, apiKey, apiSecret, confirmReadOnly });
    setState({ ok: r.ok, text: r.ok ? "API key cifrata e salvata (sola lettura)." : r.error ?? "Errore." });
    if (r.ok) {
      setLabel("");
      setApiKey("");
      setApiSecret("");
      setConfirmReadOnly(false);
      router.refresh();
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="space-y-3 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="gm-label" htmlFor="c-venue">
            Exchange
          </label>
          <select id="c-venue" className="gm-input" value={venueId} onChange={(e) => setVenueId(e.target.value)}>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="gm-label" htmlFor="c-label">
            Etichetta
          </label>
          <input id="c-label" className="gm-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Es. Kraken read-only" />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="gm-label" htmlFor="c-key">
            API key
          </label>
          <input id="c-key" className="gm-input font-mono text-xs" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label className="gm-label" htmlFor="c-secret">
            API secret
          </label>
          <input id="c-secret" className="gm-input font-mono text-xs" type="password" value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} autoComplete="new-password" />
        </div>
      </div>
      <label className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
        <input type="checkbox" className="mt-0.5" checked={confirmReadOnly} onChange={(e) => setConfirmReadOnly(e.target.checked)} />
        <span>
          Confermo che questa chiave ha <strong className="text-paper">solo permessi di lettura</strong> e che i <strong className="text-paper">prelievi sono disabilitati</strong>.
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="gm-btn-accent py-1.5 text-xs" disabled={busy || !confirmReadOnly}>
          {busy ? "Cifratura…" : "Salva API key"}
        </button>
        {state ? <span className={state.ok ? "text-[11px] text-pos" : "text-[11px] text-neg"}>{state.text}</span> : null}
      </div>
      <p className="text-[11px] leading-relaxed text-muted">
        Le chiavi sono cifrate con AES-256-GCM e non vengono mai mostrate in chiaro. Questa build non usa le chiavi private per operare: servono solo per
        predisporre la lettura saldi quando il router live sarà autorizzato.
      </p>
    </form>
  );
}
