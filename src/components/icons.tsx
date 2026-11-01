import type { ReactNode } from "react";

export type IconName =
  | "grid"
  | "chart"
  | "target"
  | "layers"
  | "exchange"
  | "wallet"
  | "percent"
  | "history"
  | "brain"
  | "settings"
  | "shield"
  | "users"
  | "logout"
  | "lock"
  | "menu"
  | "close"
  | "refresh"
  | "check"
  | "alert"
  | "download"
  | "plus"
  | "external"
  | "spark"
  | "bolt";

const paths: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  chart: (
    <>
      <path d="M3 20h18" />
      <path d="M6.5 16.5V11" />
      <path d="M12 16.5V5.5" />
      <path d="M17.5 16.5V8.5" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3.5 20.5 8 12 12.5 3.5 8 12 3.5Z" />
      <path d="M4 12.5 12 17l8-4.5" />
      <path d="M4 16.5 12 21l8-4.5" />
    </>
  ),
  exchange: (
    <>
      <path d="M4 8h13l-3.5-3.5" />
      <path d="M20 16H7l3.5 3.5" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10.5h18" />
      <circle cx="17" cy="15" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  percent: (
    <>
      <path d="M19 5 5 19" />
      <circle cx="7.5" cy="7.5" r="2.6" />
      <circle cx="16.5" cy="16.5" r="2.6" />
    </>
  ),
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4v5h5" />
      <path d="M12 8v4.5l3 2" />
    </>
  ),
  brain: (
    <>
      <path d="M12 4.5 13.7 9l4.5 1.7-4.5 1.7L12 17l-1.7-4.6L5.8 10.7 10.3 9 12 4.5Z" />
      <path d="M18 16.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 19 6v6c0 4.2-3 7.4-7 9-4-1.6-7-4.8-7-9V6l7-3Z" />
      <path d="M9 12.2l2.2 2.2L15.5 10" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 5.5a3 3 0 0 1 0 5.8" />
      <path d="M17.5 15.2c2 .6 3.5 2.3 3.5 4.8" />
    </>
  ),
  logout: (
    <>
      <path d="M15 12H3.5" />
      <path d="M8 8l-4 4 4 4" />
      <path d="M14 4h4.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H14" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="10.5" rx="2.5" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <path d="M12 14.5v2.5" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </>
  ),
  close: (
    <>
      <path d="M6 6l12 12M18 6L6 18" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4.5V11h-6" />
    </>
  ),
  check: (
    <>
      <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 21 19.5H3L12 3.5Z" />
      <path d="M12 9v5" />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7.5 11 12 15.5 16.5 11" />
      <path d="M4 20h16" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14.5v4.5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6H10" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.5l1.6 4.9 4.9 1.6-4.9 1.6L12 16.5l-1.6-4.9L5.5 10l4.9-1.6L12 3.5Z" />
    </>
  ),
  bolt: (
    <>
      <path d="M13.5 2.5 5 13.5h5.5L10 21.5 19 10h-5.5l0-7.5Z" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  className,
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
