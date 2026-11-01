import type { CSSProperties, ReactNode } from "react";

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export function Card({
  children,
  className,
  gold,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  gold?: boolean;
  as?: "section" | "div" | "article" | "aside";
}) {
  return <Tag className={cn("gm-card", gold && "gm-panel-gold", className)}>{children}</Tag>;
}

export function CardHead({
  title,
  subtitle,
  action,
  icon,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3.5 sm:px-5" style={{ borderColor: "var(--color-line)" }}>
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <div className="mt-0.5 text-[var(--accent)]">{icon}</div> : null}
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold tracking-wide text-paper">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs leading-relaxed text-muted">{subtitle}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const toneClass: Record<string, string> = {
  neutral: "gm-badge",
  gold: "gm-badge gm-badge-gold",
  pos: "gm-badge gm-badge-pos",
  neg: "gm-badge gm-badge-neg",
  warn: "gm-badge gm-badge-warn",
};

export function Badge({
  children,
  tone = "neutral",
  title,
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof toneClass;
  title?: string;
  className?: string;
}) {
  return (
    <span className={cn(toneClass[tone], className)} title={title}>
      {children}
    </span>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = "neutral",
  hint,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "neutral" | "pos" | "neg" | "gold" | "warn";
  hint?: string;
}) {
  const valueTone =
    tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : tone === "gold" ? "gold-text" : tone === "warn" ? "text-warn" : "text-paper";
  return (
    <div className="gm-card px-4 py-3.5" title={hint}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{label}</div>
      <div className={cn("num mt-1.5 text-xl font-semibold leading-tight sm:text-2xl", valueTone)}>{value}</div>
      {sub ? <div className="mt-1 text-[11px] leading-snug text-muted">{sub}</div> : null}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-sm font-semibold text-paper">{title}</div>
      {body ? <div className="max-w-md text-xs leading-relaxed text-muted">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Callout({
  tone = "neutral",
  title,
  children,
}: {
  tone?: "neutral" | "warn" | "neg" | "pos" | "gold";
  title?: string;
  children: ReactNode;
}) {
  const styles: Record<string, string> = {
    neutral: "border-line bg-white/[0.02]",
    warn: "border-[rgba(245,181,68,0.3)] bg-[rgba(245,181,68,0.07)]",
    neg: "border-[rgba(255,107,107,0.3)] bg-[rgba(255,107,107,0.07)]",
    pos: "border-[rgba(61,220,151,0.3)] bg-[rgba(61,220,151,0.07)]",
    gold: "border-[rgba(212,175,55,0.3)] bg-[rgba(212,175,55,0.07)]",
  };
  return (
    <div className={cn("rounded-xl border px-3.5 py-3 text-xs leading-relaxed", styles[tone])}>
      {title ? <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-paper">{title}</div> : null}
      <div className="text-muted">{children}</div>
    </div>
  );
}

export function KV({ rows }: { rows: { k: string; v: ReactNode; hint?: string }[] }) {
  return (
    <dl className="divide-y" style={{ borderColor: "var(--color-line)" }}>
      {rows.map((r) => (
        <div key={r.k} className="flex items-start justify-between gap-4 px-4 py-2.5 text-sm">
          <dt className="text-muted" title={r.hint}>
            {r.k}
          </dt>
          <dd className="num text-right font-medium text-paper">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* -------------------------------------------------------------------------- */
/* Charts (dependency-free SVG)                                               */
/* -------------------------------------------------------------------------- */

export function Sparkline({
  values,
  width = 220,
  height = 44,
  tone = "gold",
  className,
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: "gold" | "pos" | "neg";
  className?: string;
}) {
  const stroke = tone === "pos" ? "var(--color-pos)" : tone === "neg" ? "var(--color-neg)" : "var(--color-gold)";
  if (values.length < 2) {
    return <div className={cn("h-11 w-full rounded bg-white/[0.02]", className)} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((v, i) => `${(i * step).toFixed(2)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(2)}`);
  return (
    <svg className={cn("w-full", className)} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="serie storica">
      <polyline points={points.join(" ")} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function AreaChart({
  points,
  height = 180,
  zeroLine = true,
  formatValue,
}: {
  points: { label: string; value: number }[];
  height?: number;
  zeroLine?: boolean;
  formatValue?: (v: number) => string;
}) {
  if (points.length < 2) {
    return <Empty title="Dati insufficienti" body="Servono almeno due scansioni per disegnare il grafico del margine." />;
  }
  const w = 720;
  const h = height;
  const pad = { l: 6, r: 6, t: 10, b: 18 };
  const values = points.map((p) => p.value).filter((v) => Number.isFinite(v));
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const x = (i: number) => pad.l + (i / (points.length - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - min) / span) * (h - pad.t - pad.b);
  const line = points.map((p, i) => `${x(i).toFixed(2)},${y(Number.isFinite(p.value) ? p.value : 0).toFixed(2)}`);
  const area = `M${x(0)},${h - pad.b} L${line.join(" L")} L${x(points.length - 1)},${h - pad.b} Z`;
  const zeroY = y(0);

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="margine netto nel tempo">
        <defs>
          <linearGradient id="gm-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-gold)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--color-gold)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {zeroLine ? (
          <line x1={pad.l} x2={w - pad.r} y1={zeroY} y2={zeroY} stroke="rgba(255,255,255,0.16)" strokeDasharray="4 4" strokeWidth="1" />
        ) : null}
        <path d={area} fill="url(#gm-area)" />
        <polyline points={line.join(" ")} fill="none" stroke="var(--color-gold)" strokeWidth="1.8" strokeLinejoin="round" />
        <text x={pad.l} y={h - 4} fill="#6d6d78" fontSize="10">
          {points[0].label}
        </text>
        <text x={w - pad.r} y={h - 4} fill="#6d6d78" fontSize="10" textAnchor="end">
          {points[points.length - 1].label}
        </text>
        {formatValue ? (
          <text x={w - pad.r} y={pad.t + 10} fill="#8c8c97" fontSize="10" textAnchor="end">
            max {formatValue(max)}
          </text>
        ) : null}
      </svg>
    </div>
  );
}

export function Gauge({ value, max, tone = "gold" }: { value: number; max: number; tone?: "gold" | "pos" | "neg" | "warn" }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const color = tone === "pos" ? "var(--color-pos)" : tone === "neg" ? "var(--color-neg)" : tone === "warn" ? "var(--color-warn)" : "var(--color-gold)";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
      <div className="h-full rounded-full" style={{ width: `${ratio * 100}%`, background: color }} />
    </div>
  );
}

export const accentVar = (accent?: string | null): CSSProperties => ({ ["--accent" as string]: accent || "#d4af37" });
