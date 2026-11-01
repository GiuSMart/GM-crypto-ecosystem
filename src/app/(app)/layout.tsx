import AppShell from "@/components/AppShell";
import { requireUser } from "@/lib/auth";
import { getBranding, getUserSettings } from "@/lib/db";
import { activeLiveAuthorization } from "@/lib/live";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const branding = getBranding();
  const settings = getUserSettings(user.id);
  const live = activeLiveAuthorization(user.id);

  return (
    <AppShell
      user={{
        displayName: user.displayName,
        email: user.email,
        role: user.role,
        plan: user.plan,
        mustChangePassword: user.mustChangePassword,
      }}
      branding={{
        appName: user.brandName || branding.appName,
        logoMark: branding.logoMark,
        accent: user.brandAccent || branding.accent,
        tagline: branding.tagline,
        footer: branding.footer,
      }}
      mode={{
        monitoring: settings.monitoringEnabled,
        paperAutoFollow: settings.paperAutoFollow,
        liveTradingEnabled: settings.liveTradingEnabled,
        liveAuthorized: Boolean(live),
      }}
    >
      {children}
    </AppShell>
  );
}
