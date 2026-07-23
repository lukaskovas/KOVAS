import Link from "next/link";
import { Suspense } from "react";
import SyncStatus from "./sync-status";
import RefreshButton from "./refresh-button";
import { signOut } from "./login/actions";
import type { CurrentUser } from "@/lib/auth";

/**
 * Wspólna rama panelu: nagłówek marki, wskaźnik synchronizacji i zakładki najwyższego poziomu.
 * Wydzielona z app/page.tsx, gdy doszła strona /raporty - obie muszą mieć identyczną nawigację.
 */

export type TopTab = "orders" | "products" | "companies" | "raporty";

const TABS: { key: TopTab; label: string; href: string }[] = [
  { key: "orders", label: "Raport zamówień", href: "/?view=orders" },
  { key: "products", label: "Sprzedaż produktów", href: "/?view=products" },
  { key: "companies", label: "Kontrahenci", href: "/?view=companies" },
  { key: "raporty", label: "Raporty", href: "/raporty" },
];

export default function Shell({
  active,
  user,
  children,
}: {
  // null na stronach poza zakładkami raportów (Moje konto, Użytkownicy)
  active: TopTab | null;
  user: CurrentUser;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-full">
      <header className="bg-plum text-cream">
        <div className="flex items-center justify-between px-6 py-5">
          <div className="flex items-baseline gap-3">
            <span className="font-display text-xl font-bold uppercase tracking-[0.2em]">Kovas</span>
            <span className="font-display text-xs uppercase tracking-widest text-gold">Raporty (Turis + wFirma)</span>
          </div>
          <div className="flex items-center gap-5">
            <Suspense fallback={null}>
              <SyncStatus />
            </Suspense>
            <RefreshButton />
            <div className="font-display flex items-center gap-4 text-xs uppercase tracking-wider">
              {user.role === "admin" && (
                <Link href="/admin/uzytkownicy" className="text-gold hover:text-cream">
                  Użytkownicy
                </Link>
              )}
              <Link href="/konto" className="text-gold hover:text-cream">
                {user.email}
              </Link>
              <form action={signOut}>
                <button type="submit" className="text-gold uppercase tracking-wider hover:text-cream">
                  Wyloguj
                </button>
              </form>
            </div>
          </div>
        </div>
      </header>

      {/* Pełna szerokość, nie max-w - raport ma 23 kolumny i tak się nie mieści */}
      <main className="px-6 py-6">
        <nav className="mb-6 inline-flex border-2 border-gold bg-white">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              prefetch
              className={`font-display px-5 py-3 text-xs font-semibold uppercase tracking-wider transition ${
                active === t.key ? "bg-plum text-cream" : "text-plum hover:bg-sand"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        {children}
      </main>
    </div>
  );
}
