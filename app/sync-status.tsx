import { getSyncHealth } from "@/lib/queries";
import { fmtRelative } from "@/lib/format";

/** Wskaźnik świeżości danych w nagłówku - wyciągnięty z app/page.tsx, bo używa go też /raporty. */

const SOURCE_LABELS: Record<string, string> = {
  turis_companies: "kontrahenci",
  turis_products: "produkty",
  turis_orders_backfill: "zamówienia",
  wfirma_invoices: "faktury",
  order_invoice_matcher: "dopasowanie",
};

export default async function SyncStatus() {
  const health = await getSyncHealth();
  if (!health.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-cream/60">
      {health.map((h) => {
        const dot = h.status === "success" ? "bg-gold-deep" : h.status === "partial" ? "bg-amber-400" : "bg-rose-400";
        const label = SOURCE_LABELS[h.source] ?? h.source;
        return (
          <span key={h.source} className="inline-flex items-center gap-1.5" title={h.error_message ?? undefined}>
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${dot}`} />
            {label}: {fmtRelative(h.finished_at)}
          </span>
        );
      })}
    </div>
  );
}
