import { getSyncHealth, type SyncHealthRow } from "@/lib/queries";
import { fmtRelative } from "@/lib/format";

/** Wskaźnik świeżości danych w nagłówku - wyciągnięty z app/page.tsx, bo używa go też /raporty. */

/**
 * Źródła synchronizacji, które chodzą automatycznie (crony na Vercelu):
 * cron Turis co 15 min + cron wFirma co godzinę. Reszta (turis_brands, turis_orders_backfill,
 * wfirma_invoices_refresh) odpala się tylko lokalnie ze skryptów - nie liczymy jej do świeżości,
 * bo zaniżałaby wynik ("dane sprzed 2 dni"), choć realne dane są aktualne.
 */
const CRON_SOURCES: Record<string, string> = {
  turis_companies: "kontrahenci",
  turis_products: "produkty",
  turis_orders_delta: "nowe zamówienia",
  turis_orders_open_refresh: "otwarte zamówienia",
  wfirma_invoices: "faktury",
  order_invoice_matcher: "dopasowanie",
};

/**
 * Źródła dobowe/wolniejsze - pokazujemy w tooltipie i alertujemy przy błędzie, ale NIE wliczamy
 * do "Dane aktualne", bo raz dzienny sync (przyjęcia) zaniżałby nagłówek do "~24h temu" mimo
 * świeżych zamówień. Przyjęcia to inna domena (zakupy, nie sprzedaż) i mają własną kadencję.
 */
const SECONDARY_SOURCES: Record<string, string> = {
  wfirma_receipts: "przyjęcia",
};

const LABELS: Record<string, string> = { ...CRON_SOURCES, ...SECONDARY_SOURCES };

export default async function SyncStatus() {
  const health = await getSyncHealth();
  const rows = health.filter((h): h is SyncHealthRow => h.source in LABELS);
  if (!rows.length) return null;

  // "Dane aktualne: X" = najstarszy zakończony sync z SZYBKIEJ pętli (bez źródeł dobowych).
  const finished = rows
    .filter((r) => r.source in CRON_SOURCES)
    .map((r) => r.finished_at)
    .filter((t): t is string => !!t);
  const oldest = finished.length
    ? finished.reduce((a, b) => (new Date(a) <= new Date(b) ? a : b))
    : null;

  const failed = rows.filter((r) => r.status === "failed");

  // Tooltip: pełny rozkład per źródło (łącznie z dobowymi), żeby szczegół był pod ręką.
  const breakdown = rows
    .map((r) => `${LABELS[r.source]}: ${fmtRelative(r.finished_at)}${r.status === "failed" ? " (błąd)" : ""}`)
    .join("\n");

  const dot = failed.length ? "bg-rose-400" : "bg-gold-deep";
  const text = failed.length
    ? `Problem z synchronizacją: ${failed.map((r) => LABELS[r.source]).join(", ")}`
    : `Dane aktualne: ${fmtRelative(oldest)}`;

  return (
    <div className="text-xs text-cream/60">
      <span className="inline-flex items-center gap-1.5" title={breakdown}>
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
        {text}
      </span>
    </div>
  );
}
