import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GM CRYPTO ARBITRAGE AI",
  description:
    "Piattaforma di monitoraggio multi-venue per opportunità di arbitraggio crypto con calcolo del profitto netto dopo tutte le commissioni.",
  applicationName: "GM CRYPTO ARBITRAGE AI",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#050507",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
