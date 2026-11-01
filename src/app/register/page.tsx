import Link from "next/link";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/AuthForms";
import { Icon } from "@/components/icons";
import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const user = await currentUser();
  if (user) redirect("/");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl border border-[rgba(212,175,55,0.45)] bg-[rgba(212,175,55,0.1)] text-sm font-bold text-gold">GM</span>
        <div>
          <div className="text-sm font-bold tracking-[0.14em] text-paper">GM CRYPTO ARBITRAGE AI</div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted">nuovo account</div>
        </div>
      </div>

      <div className="gm-card p-5 sm:p-6">
        <h1 className="text-lg font-semibold text-paper">Crea il tuo account</h1>
        <p className="mb-5 mt-1 text-xs text-muted">
          Ogni account ha dashboard, impostazioni e storico separati. Il piano FREE include 2 venue, 3 coppie e paper trading.
        </p>
        <RegisterForm />
        <div className="mt-5 border-t pt-4 text-xs text-muted" style={{ borderColor: "var(--color-line)" }}>
          Hai già un account?{" "}
          <Link href="/login" className="font-semibold text-gold hover:underline">
            Accedi
          </Link>
        </div>
      </div>

      <ul className="mt-5 space-y-2 text-[11px] leading-relaxed text-muted">
        <li className="flex gap-2">
          <Icon name="shield" size={14} className="mt-0.5 shrink-0 text-gold" />
          Non chiediamo mai seed phrase o chiavi private. Le API key, se inserite, sono cifrate AES-256-GCM e senza permesso di prelievo.
        </li>
        <li className="flex gap-2">
          <Icon name="lock" size={14} className="mt-0.5 shrink-0 text-gold" />
          Password con hash scrypt, sessioni revocabili, rate limiting sugli accessi.
        </li>
      </ul>
    </main>
  );
}
