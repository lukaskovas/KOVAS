import Link from "next/link";
import { getReport, getFilterOptions, type Filters } from "@/lib/queries";
import { getKpi, type Kpi } from "@/lib/analytics";
import { COLUMNS, type ReportView } from "@/lib/report-columns";
import TableClient, { type Row } from "./table-client";
import FiltersBar from "./filters";
import { fmtMoney } from "@/lib/format";

export type View = ReportView;

const LABELS: Record<ReportView, string> = {
  orders: "zamówień",
  products: "pozycji sprzedaży",
  companies: "kontrahentów",
};

function Pager({ view, current, last, params }: { view: ReportView; current: number; last: number; params: Record<string, string | undefined> }) {
  const href = (p: number) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") next.set(k, v);
    next.set("view", view);
    next.set("page", String(p));
    return `/?${next.toString()}`;
  };
  const base = "inline-flex items-center gap-1 border border-gold bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wider text-plum transition hover:bg-sand";
  const off = "pointer-events-none opacity-40";
  return (
    <div className="flex items-center justify-between border-t border-sand px-4 py-3">
      <Link href={href(Math.max(1, current - 1))} className={`${base} ${current <= 1 ? off : ""}`}>← Poprzednia</Link>
      <span className="text-sm text-plum/60">Strona <b className="text-plum">{current}</b> z {last.toLocaleString("pl-PL")}</span>
      <Link href={href(Math.min(last, current + 1))} className={`${base} ${current >= last ? off : ""}`}>Następna →</Link>
    </div>
  );
}

/**
 * Sumy dla całego przefiltrowanego zbioru - to, o co pyta zarząd ("ile zarobiliśmy").
 *
 * Liczy je baza (report_kpi), nie ta funkcja. Wcześniej szło to przez getOrderTotals, które
 * ściągało WSZYSTKIE przefiltrowane zamówienia porcjami po 1000, jedna porcja po drugiej,
 * z najcięższego widoku - przy 10 478 zamówieniach ~11 zapytań pod rząd (kilka sekund)
 * po to, żeby wyświetlić cztery liczby. Teraz jest to jeden agregat.
 */
function Totals({ kpi }: { kpi: Kpi | null }) {
  if (!kpi || !Number(kpi.orders_count)) return null;
  const missingRate = Number(kpi.missing_rate_count) || 0;
  const items: [string, number][] = [
    ["Przychód netto PLN", Number(kpi.net_pln)],
    ["Przychód brutto PLN", Number(kpi.gross_pln)],
    ["CoGS", Number(kpi.cogs_pln)],
    ["Marża", Number(kpi.margin_pln)],
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, val]) => (
        <div key={label} className="border-t-2 border-gold bg-white px-4 py-3">
          <div className="font-display text-xs uppercase tracking-wider text-plum/60">{label}</div>
          <div className="mt-1 text-lg font-semibold tabular-nums text-plum-dark">{fmtMoney(val)}</div>
        </div>
      ))}
      {missingRate > 0 && (
        <div className="col-span-2 text-xs text-amber-700 sm:col-span-4">
          Uwaga: {missingRate} zamówień nie ma kursu NBP na swoją datę i nie weszło do sum.
          Uruchom <code>npm run sync-fx</code>, żeby uzupełnić notowania.
        </div>
      )}
    </div>
  );
}

export default async function ViewData({
  view,
  page,
  filters,
  params,
}: {
  view: ReportView;
  page: number;
  filters: Filters;
  params: Record<string, string | undefined>;
}) {
  // Wszystkie trzy zapytania równolegle. Sumy szły wcześniej osobnym komponentem
  // renderowanym dopiero po tabeli, więc ich czas doklejał się do czasu tabeli zamiast
  // z nim nakładać.
  const [{ data, total, lastPage }, options, kpi] = await Promise.all([
    getReport<Row>(view, page, filters),
    getFilterOptions(),
    view === "orders" ? getKpi(filters) : Promise.resolve(null),
  ]);

  const note =
    view === "orders" || view === "products"
      ? "CoGS pochodzi z dokumentów przyjęć wFirma (Turis nie ma cen kosztowych). Koszt liczony metodą EASI - cena z pierwszego przyjęcia towaru - żeby dało się porównać liczby 1:1 z ich raportem; docelowa metoda do zatwierdzenia. 71 produktów nie ma kosztu (brak przyjęcia w wFirmie), więc pokazują marżę 100% (patrz docs/analiza-easi/LUKI-DANYCH.md)."
      : undefined;

  return (
    <>
      {view === "orders" && <Totals kpi={kpi} />}
      <div className="mb-4 flex items-baseline gap-2">
        <span className="font-display text-2xl font-bold tabular-nums text-plum-dark">{total.toLocaleString("pl-PL")}</span>
        <span className="text-sm text-plum/60">{LABELS[view]}</span>
      </div>
      <div className="overflow-hidden border border-gold bg-white">
        <FiltersBar view={view} active={params} options={options} total={total} />
        <TableClient view={view} columns={COLUMNS[view]} rows={data} params={params} note={note} />
        <Pager view={view} current={page} last={lastPage} params={params} />
      </div>
    </>
  );
}

export function TableSkeleton() {
  return (
    <>
      <div className="mb-4 h-8 w-40 animate-pulse bg-sand" />
      <div className="overflow-hidden border border-gold bg-white">
        <div className="border-b border-gold bg-cream px-4 py-3">
          <div className="h-3 w-24 animate-pulse bg-sand" />
        </div>
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-sand px-4 py-3.5 last:border-0">
            <div className="h-3 w-10 animate-pulse bg-cream" />
            <div className="h-3 flex-1 animate-pulse bg-cream" />
            <div className="h-5 w-20 animate-pulse bg-cream" />
            <div className="h-3 w-24 animate-pulse bg-cream" />
          </div>
        ))}
      </div>
    </>
  );
}
