export const money = (v: number | null | undefined, currency = "USD", digits = 2) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
};

export const num = (v: number | null | undefined, digits = 2) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
};

export const pct = (v: number | null | undefined, digits = 3) => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${num(v, digits)}%`;
};

export const signed = (v: number | null | undefined, currency = "USD") => {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const s = money(Math.abs(v), currency);
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}`;
};

export const dt = (iso: string | number | Date | null | undefined) => {
  if (!iso) return "—";
  const d = typeof iso === "object" ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

export const timeOnly = (iso: string | number | Date) => {
  const d = typeof iso === "object" ? iso : new Date(iso);
  return new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d);
};

export const ago = (iso: string | number | Date | null | undefined) => {
  if (!iso) return "—";
  const t = (typeof iso === "object" ? iso.getTime() : new Date(iso).getTime()) / 1000;
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - t));
  if (diff < 60) return `${diff}s fa`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m fa`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h fa`;
  return `${Math.floor(diff / 86400)}g fa`;
};

export const shortNum = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `${num(v / 1_000_000, 2)}M`;
  if (Math.abs(v) >= 1_000) return `${num(v / 1_000, 1)}k`;
  return num(v, 2);
};
