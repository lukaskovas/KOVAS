"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Ręczne odświeżenie danych z nagłówka - odpala /api/refresh (cały cykl: zamówienia + statusy z Turis,
 * faktury z wFirmy, dopasowanie, migawka). Po sukcesie router.refresh() przeładowuje dane strony
 * (Server Components), żeby świeże liczby były widać bez F5. Stan błędu/sukcesu znika sam po chwili.
 */
export default function RefreshButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [, startTransition] = useTransition();

  async function run() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      // Przeładuj dane Server Components, żeby nowe zamówienia/faktury/statusy były widać od razu.
      startTransition(() => router.refresh());
      setMsg({ kind: "ok", text: "Zaktualizowano" });
    } catch (err) {
      setMsg({ kind: "err", text: "Błąd odświeżania" });
      console.error("Ręczne odświeżenie nie powiodło się:", err);
    } finally {
      setBusy(false);
      setTimeout(() => setMsg(null), 5000);
    }
  }

  const spinner = (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5 animate-spin"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );

  // W trakcie odświeżania chowamy przycisk i pokazujemy komunikat - żeby nikt nie klikał w kółko
  // i nie odpalał kolejnych synców (każdy obciąża API Turis/wFirma).
  if (busy) {
    return (
      <span className="font-display inline-flex items-center gap-1.5 border-2 border-gold bg-gold/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gold">
        {spinner}
        Trwa odświeżanie danych...
      </span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={run}
        title="Pobierz nowe zamówienia, statusy i faktury z Turis + wFirma"
        className="font-display inline-flex items-center gap-1.5 border-2 border-gold px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-gold transition hover:bg-gold hover:text-plum"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
        Odśwież
      </button>
      {msg && (
        <span className={`text-xs ${msg.kind === "ok" ? "text-gold" : "text-rose-300"}`}>{msg.text}</span>
      )}
    </div>
  );
}
