import Link from "next/link";
import { Suspense } from "react";
import { getReport, getFilterOptions, getContractorOptions, type Filters } from "@/lib/queries";
import { getKpi, type Kpi } from "@/lib/analytics";
import { COLUMNS, type ReportView } from "@/lib/report-columns";
import TableClient, { type Row } from "./table-client";
import FiltersBar from "./filters";
import AddContractorPanel from "./admin/kontrahenci/add-contractor-panel";
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
  const missingCost = Number(kpi.missing_cost_count) || 0;
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
      {missingCost > 0 && (
        <div className="col-span-2 text-xs text-amber-700 sm:col-span-4">
          Uwaga: Marża dla starszych zamówień jest SZACOWANA kosztem migracyjnym (jak EASI), dla
          nowszych - dokładna z wydań WZ. {missingCost} zamówień nadal nie ma kosztu (produkt spoza
          katalogu wFirmy) i nie wchodzi do marży.
        </div>
      )}
      {missingRate > 0 && (
        <div className="col-span-2 text-xs text-amber-700 sm:col-span-4">
          Uwaga: {missingRate} zamówień nie ma kursu NBP na swoją datę i nie weszło do sum.
          Uruchom <code>npm run sync-fx</code>, żeby uzupełnić notowania.
        </div>
      )}
    </div>
  );
}

/**
 * Podsumowanie (KPI) jako OSOBNY strumień - najcięższe i jedyne niecacheowane zapytanie
 * (report_kpi liczy m.in. distinct SKU po ~89 tys. pozycji). Trzymane poza głównym
 * Promise.all tabeli, żeby:
 *  - tabela ładowała się od razu, a kafelki dostreamowały się chwilę później,
 *  - timeout bazy na KPI NIE wywalał całej strony (błąd łapiemy tu, nie leci do error boundary).
 */
async function OrdersTotals({ filters }: { filters: Filters }) {
  let kpi: Kpi | null = null;
  try {
    kpi = await getKpi(filters);
  } catch {
    return (
      <div className="mb-4 border-t-2 border-amber-400 bg-white px-4 py-3 text-xs text-amber-700">
        Nie udało się teraz policzyć podsumowania (przekroczony czas bazy przy tak szerokim zakresie).
        Tabela poniżej działa niezależnie - zawęź zakres dat albo odśwież stronę, żeby spróbować ponownie.
      </div>
    );
  }
  return <Totals kpi={kpi} />;
}

/** Placeholder kafelków podsumowania na czas doliczania KPI. */
function TotalsSkeleton() {
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="border-t-2 border-gold bg-white px-4 py-3">
          <div className="h-3 w-24 animate-pulse bg-sand" />
          <div className="mt-2 h-5 w-28 animate-pulse bg-cream" />
        </div>
      ))}
    </div>
  );
}

export default async function ViewData({
  view,
  page,
  filters,
  params,
  isAdmin,
}: {
  view: ReportView;
  page: number;
  filters: Filters;
  params: Record<string, string | undefined>;
  isAdmin: boolean;
}) {
  // Tabela + opcje filtrów + kontrahenci równolegle. KPI (sumy) świadomie NIE ma tu -
  // to najcięższe, niecacheowane zapytanie, więc streamuje się osobno (OrdersTotals niżej),
  // żeby tabela pojawiała się od razu, a jej ewentualny timeout nie blokował ani nie wywalał strony.
  const [{ data, total, lastPage }, options, contractors] = await Promise.all([
    getReport<Row>(view, page, filters),
    getFilterOptions(),
    // Wyszukiwarka kontrahenta tylko na zamówieniach - nie ma sensu ciągnąć listy dla innych widoków
    view === "orders" ? getContractorOptions() : Promise.resolve([]),
  ]);

  const note =
    view === "orders" || view === "products"
      ? "CoGS liczony dwustopniowo: dla ery wFirmy (od 04.2026) to realny koszt z dokumentów wydania WZ (faktycznie zdjęty z magazynu, dowiązany przez fakturę); dla starszych zamówień - koszt SZACOWANY metodą migracyjną (cena z pierwszego przyjęcia towaru, tak samo jak EASI). Zamówienia z produktem spoza katalogu wFirmy (wycofanym przed migracją) nie mają kosztu, więc CoGS i marża są dla nich puste (\"-\") zamiast mylącego 100%. Marża liczona bez transportu (patrz docs/analiza-easi/LUKI-DANYCH.md)."
      : undefined;

  return (
    <>
      {view === "orders" && (
        <Suspense fallback={<TotalsSkeleton />}>
          <OrdersTotals filters={filters} />
        </Suspense>
      )}
      {view === "companies" && isAdmin && (
        <AddContractorPanel agents={options.agents} ctypes={options.ctypes} />
      )}
      <div className="mb-4 flex items-baseline gap-2">
        <span className="font-display text-2xl font-bold tabular-nums text-plum-dark">{total.toLocaleString("pl-PL")}</span>
        <span className="text-sm text-plum/60">{LABELS[view]}</span>
      </div>
      <div className="overflow-hidden border border-gold bg-white">
        <FiltersBar view={view} active={params} options={options} contractors={contractors} total={total} />
        <TableClient view={view} columns={COLUMNS[view]} rows={data} params={params} note={note} canEdit={view === "companies" && isAdmin} />
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
