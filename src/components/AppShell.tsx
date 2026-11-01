"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";
import { cn } from "./ui";

export type ShellUser = {
  displayName: string;
  email: string;
  role: "admin" | "client";
  plan: string;
  mustChangePassword: boolean;
};

export type ShellBranding = { appName: string; logoMark: string; accent: string; tagline: string; footer: string };

export type ShellMode = {
  monitoring: boolean;
  paperAutoFollow: boolean;
  liveTradingEnabled: boolean;
  liveAuthorized: boolean;
};

type NavItem = { href: string; label: string; icon: IconName; adminOnly?: boolean };

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Operatività",
    items: [
      { href: "/", label: "Panoramica", icon: "grid" },
      { href: "/markets", label: "Mercati", icon: "chart" },
      { href: "/opportunities", label: "Opportunità", icon: "target" },
      { href: "/paper", label: "Paper trading", icon: "layers" },
    ],
  },
  {
    section: "Infrastruttura",
    items: [
      { href: "/exchanges", label: "Exchange", icon: "exchange" },
      { href: "/wallets", label: "Wallet", icon: "wallet" },
      { href: "/fees", label: "Commissioni", icon: "percent" },
    ],
  },
  {
    section: "Dati e AI",
    items: [
      { href: "/history", label: "Storico", icon: "history" },
      { href: "/intelligence", label: "GM Intelligence", icon: "brain" },
    ],
  },
  {
    section: "Account",
    items: [
      { href: "/affiliate", label: "Affiliate Center", icon: "spark" },
      { href: "/settings", label: "Impostazioni", icon: "settings" },
      { href: "/security", label: "Sicurezza", icon: "shield" },
      { href: "/admin", label: "Amministrazione", icon: "users", adminOnly: true },
    ],
  },
];

export default function AppShell({
  user,
  branding,
  mode,
  children,
}: {
  user: ShellUser;
  branding: ShellBranding;
  mode: ShellMode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const logout = async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen" style={{ ["--accent" as string]: branding.accent }}>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b bg-ink/85 px-3 py-2.5 backdrop-blur lg:hidden" style={{ borderColor: "var(--color-line)" }}>
        <button className="gm-btn-ghost" onClick={() => setOpen((v) => !v)} aria-label="Apri menu" aria-expanded={open}>
          <Icon name={open ? "close" : "menu"} size={20} />
        </button>
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-md border border-[rgba(212,175,55,0.4)] bg-[rgba(212,175,55,0.12)] text-[11px] font-bold text-[var(--accent)]">
            {branding.logoMark}
          </span>
          <span className="truncate text-xs font-semibold tracking-[0.1em] text-paper">{branding.appName}</span>
        </div>
        <span className={cn("gm-badge", mode.monitoring ? "gm-badge-pos" : "gm-badge-warn")}>{mode.monitoring ? "LIVE" : "PAUSA"}</span>
      </header>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-[268px] transform border-r bg-obsidian/95 backdrop-blur transition-transform duration-200 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
        style={{ borderColor: "var(--color-line)" }}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 border-b px-4 py-4" style={{ borderColor: "var(--color-line)" }}>
            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-[rgba(212,175,55,0.45)] bg-[rgba(212,175,55,0.1)] text-sm font-bold text-[var(--accent)]">
                {branding.logoMark}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-bold leading-tight tracking-[0.08em] text-paper">{branding.appName}</span>
                <span className="block truncate text-[10px] uppercase tracking-[0.14em] text-muted">{branding.tagline}</span>
              </span>
            </Link>
            <button className="gm-btn-ghost lg:hidden" onClick={() => setOpen(false)} aria-label="Chiudi menu">
              <Icon name="close" size={18} />
            </button>
          </div>

          <nav className="gm-scroll-x flex-1 overflow-y-auto px-2 py-3">
            {NAV.map((group) => {
              const items = group.items.filter((i) => !i.adminOnly || user.role === "admin");
              if (!items.length) return null;
              return (
                <div key={group.section} className="mb-3">
                  <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#5d5d68]">{group.section}</div>
                  <ul className="space-y-0.5">
                    {items.map((item) => {
                      const active = isActive(item.href);
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={cn(
                              "flex items-center gap-2.5 rounded-lg border-l-2 px-2.5 py-2 text-[13px] transition",
                              active
                                ? "border-l-[var(--accent)] bg-[rgba(212,175,55,0.09)] text-paper"
                                : "border-l-transparent text-muted hover:bg-white/[0.035] hover:text-paper",
                            )}
                          >
                            <Icon name={item.icon} size={16} className={active ? "text-[var(--accent)]" : "text-[#6f6f7b]"} />
                            <span className="truncate">{item.label}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </nav>

          <div className="border-t px-3 py-3" style={{ borderColor: "var(--color-line)" }}>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-paper">{user.displayName}</div>
                <div className="truncate text-[10px] text-muted">{user.email}</div>
              </div>
              <span className="gm-badge gm-badge-gold">{user.plan}</span>
            </div>
            <div className="mb-2 grid grid-cols-3 gap-1 text-center">
              <ModePill label="Monitor" on={mode.monitoring} />
              <ModePill label="Paper" on={true} />
              <ModePill label="Live" on={mode.liveTradingEnabled && mode.liveAuthorized} locked />
            </div>
            {user.mustChangePassword ? (
              <Link href="/security" className="mb-2 block rounded-md border border-[rgba(245,181,68,0.35)] bg-[rgba(245,181,68,0.08)] px-2 py-1.5 text-[10px] leading-snug text-warn">
                Password iniziale: cambiala in Sicurezza.
              </Link>
            ) : null}
            <button className="gm-btn w-full text-xs" onClick={logout} disabled={busy}>
              <Icon name="logout" size={15} />
              {busy ? "Uscita…" : "Esci"}
            </button>
          </div>
        </div>
      </aside>

      {open ? <div className="fixed inset-0 z-40 bg-black/60 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" /> : null}

      <div className="lg:pl-[268px]">
        <main className="mx-auto w-full max-w-[1500px] px-3 py-4 sm:px-5 sm:py-6 lg:px-8">{children}</main>
        <footer className="mx-auto w-full max-w-[1500px] px-4 pb-8 pt-2 text-[11px] leading-relaxed text-[#5f5f6a]">
          <div className="border-t pt-4" style={{ borderColor: "var(--color-line)" }}>
            {branding.footer}
            <div className="mt-1">
              Strumento di analisi e simulazione. Non è consulenza finanziaria. Nessun prelievo, nessuna seed phrase richiesta.
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function ModePill({ label, on, locked }: { label: string; on: boolean; locked?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-md border px-1 py-1 text-[9px] font-semibold uppercase tracking-wide",
        on ? "border-[rgba(61,220,151,0.35)] bg-[rgba(61,220,151,0.1)] text-pos" : "border-[var(--color-line)] bg-white/[0.02] text-[#6f6f7b]",
      )}
      title={locked && !on ? "Live trading bloccato: richiede autorizzazione amministratore" : undefined}
    >
      {label}
    </div>
  );
}
