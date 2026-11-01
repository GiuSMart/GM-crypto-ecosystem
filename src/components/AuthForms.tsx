"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./icons";

const post = async (url: string, body: unknown) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; data?: Record<string, unknown> };
  return { ok: res.ok && json.ok !== false, error: json.error, data: json.data };
};

export function LoginForm({ demoEmail }: { demoEmail: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post("/api/auth/login", { email, password });
    if (!r.ok) {
      setError(r.error ?? "Accesso non riuscito.");
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-4" autoComplete="on">
      <div>
        <label className="gm-label" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          className="gm-input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="nome@dominio.it"
          required
        />
      </div>
      <div>
        <label className="gm-label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="gm-input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••••"
          required
        />
      </div>

      {error ? (
        <div className="rounded-lg border border-[rgba(255,107,107,0.35)] bg-[rgba(255,107,107,0.08)] px-3 py-2 text-xs text-neg">
          {error}
        </div>
      ) : null}

      <button type="submit" className="gm-btn-accent w-full" disabled={busy}>
        <Icon name="lock" size={16} />
        {busy ? "Verifica…" : "Accedi"}
      </button>

      <button
        type="button"
        className="gm-btn-ghost w-full justify-center text-xs"
        onClick={() => setEmail(demoEmail)}
      >
        Compila l&apos;email admin
      </button>
    </form>
  );
}

export function RegisterForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await post("/api/auth/register", { displayName, email, password });
    if (!r.ok) {
      setError(r.error ?? "Registrazione non riuscita.");
      setBusy(false);
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div>
        <label className="gm-label" htmlFor="name">
          Nome
        </label>
        <input id="name" className="gm-input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Mario Rossi" required />
      </div>
      <div>
        <label className="gm-label" htmlFor="remail">
          Email
        </label>
        <input id="remail" className="gm-input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nome@dominio.it" required />
      </div>
      <div>
        <label className="gm-label" htmlFor="rpassword">
          Password
        </label>
        <input
          id="rpassword"
          className="gm-input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Min. 10 caratteri, maiuscola, numero"
          required
        />
        <p className="mt-1.5 text-[11px] leading-snug text-muted">
          Almeno 10 caratteri con una maiuscola e un numero. La password viene salvata come hash scrypt, mai in chiaro.
        </p>
      </div>

      {error ? (
        <div className="rounded-lg border border-[rgba(255,107,107,0.35)] bg-[rgba(255,107,107,0.08)] px-3 py-2 text-xs text-neg">{error}</div>
      ) : null}

      <button type="submit" className="gm-btn-accent w-full" disabled={busy}>
        {busy ? "Creazione…" : "Crea account FREE"}
      </button>
      <p className="text-center text-[11px] text-muted">
        Il piano FREE non richiede pagamenti. Nessuna carta, nessun addebito.
      </p>
    </form>
  );
}
