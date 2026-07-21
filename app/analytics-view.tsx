import {
  getKpi,
  getOrdersBy,
  getProducts,
  getDormant,
  REPORT_BY_KEY,
  STRUCTURE_BLOCKS,
  STRUCTURE_COLUMNS,
  type AggRow,
  type AnalyticsFilters,
  type Kpi,
  type PeriodKey,
  type ReportKey,
} from "@/lib/analytics";
import { matchLabel, orderStatusLabel, paymentLabel } from "@/lib/labels";
import AnalyticsTable from "./analytics-table";
import { fmtMoney } from "@/lib/format";

/**
 * Zawartość zakładki "Raporty" - każdy podraport to jedno wywołanie funkcji agregującej
 * z bazy. Komponent serwerowy: dane nie przechodzą przez przeglądarkę, a tłumaczenie
 * wartości technicznych na polskie etykiety robimy tu, przed przekazaniem do tabeli
 * (funkcji nie da się przekazać z serwera do komponentu klienckiego).
 */

const CARD = "border-t-2 border-gold bg-white px-4 py-3";
const CARD_LABEL = "font-display text-xs uppercase tracking-wider text-plum/60";
const CARD_VALUE = "mt-1 text-lg font-semibold tabular-nums text-plum-dark";

function num(v: unknown): string {
  return (Number(v) || 0).toLocaleString("pl-PL");
}

function KpiCards({ kpi }: { kpi: Kpi }) {
  const cards: [string, string][] = [
    ["Przychód netto PLN", fmtMoney(kpi.net_pln)],
    ["Przychód brutto PLN", fmtMoney(kpi.gross_pln)],
    ["Zamówień", num(kpi.orders_count)],
    ["Śr. wartość zamówienia", fmtMoney(kpi.avg_order_pln)],
    ["Kontrahentów", num(kpi.companies_count)],
    ["Sprzedanych sztuk", num(kpi.items_qty)],
    ["Produktów (SKU)", num(kpi.skus_count)],
    ["Udzielone rabaty", fmtMoney(kpi.discount_pln)],
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {cards.map(([label, value]) => (
        <div key={label} className={CARD}>
          <div className={CARD_LABEL}>{label}</div>
          <div className={CARD_VALUE}>{value}</div>
        </div>
      ))}
    </div>
  );
}

/**
 * Trend miesięczny jako słupki. Rysowany divami, bez biblioteki wykresów - jeden słupek
 * na miesiąc to za mało powodu, żeby dokładać zależność i JS do przeglądarki.
 */
function Trend({ rows }: { rows: AggRow[] }) {
  if (rows.length < 2) return null;
  const max = Math.max(...rows.map((r) => Number(r.net_pln) || 0));
  return (
    <div className="mb-4 border border-gold bg-white p-4">
      <div className={CARD_LABEL}>Przychód netto PLN wg miesięcy (ostatnie {rows.length})</div>
      <div className="mt-4 flex h-40 gap-1">
        {rows.map((r) => {
          const v = Number(r.net_pln) || 0;
          return (
            <div key={r.label} className="group flex flex-1 flex-col items-center gap-1" title={`${r.label}: ${fmtMoney(v)} PLN`}>
              <span className="text-[10px] tabular-nums text-plum/50 opacity-0 transition group-hover:opacity-100">
                {Math.round(v / 1000)} tys.
              </span>
              {/* osobny kontener na słupek: procentowa wysokość musi mieć rodzica o znanej wysokości */}
              <div className="flex w-full min-h-0 flex-1 items-end">
                <div className="w-full bg-plum transition group-hover:bg-plum-light" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
              </div>
              <span className="text-[10px] tabular-nums text-plum/50">{r.label.slice(2)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gold bg-white">
      <div className="border-b border-sand bg-cream px-4 py-2.5">
        <span className="font-display text-xs font-semibold uppercase tracking-wider text-plum">{title}</span>
      </div>
      {children}
    </div>
  );
}

/** Tłumaczenie etykiet wymiaru - w bazie siedzą wartości techniczne (Shipped, cod, matched). */
function translateRows(dim: string, rows: AggRow[]): AggRow[] {
  const fn =
    dim === "status" ? orderStatusLabel : dim === "match" ? matchLabel : dim === "payment" ? paymentLabel : null;
  if (!fn) return rows;
  return rows.map((r) => ({ ...r, label: fn(r.label) || r.label }));
}

export default async function AnalyticsView({
  report,
  period,
  filters,
  params,
  days,
}: {
  report: ReportKey;
  period: PeriodKey;
  filters: AnalyticsFilters;
  params: Record<string, string | undefined>;
  days: number;
}) {
  const def = REPORT_BY_KEY[report];

  if (report === "podsumowanie") {
    const [kpi, months, topCompanies, topProducts] = await Promise.all([
      getKpi(filters),
      getOrdersBy("month", { ...filters, sort: undefined, dir: undefined, limit: 5000 }),
      getOrdersBy("company", { ...filters, sort: undefined, dir: undefined, limit: 10 }),
      getProducts({ ...filters, sort: undefined, dir: undefined, limit: 10 }),
    ]);
    if (!kpi || !kpi.orders_count) return <Empty />;

    return (
      <>
        <KpiCards kpi={kpi} />
        <Trend rows={months.slice(-24)} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Top 10 kontrahentów">
            <AnalyticsTable
              compact
              rank
              params={params}
              rows={topCompanies}
              columns={[
                { key: "label", header: "Kontrahent", type: "text", grow: true },
                { key: "orders_count", header: "Zamówień", type: "number", align: "right" },
                { key: "net_pln", header: "Przychód netto PLN", type: "money", align: "right" },
                { key: "share_pct", header: "Udział", type: "share", align: "right" },
              ]}
            />
          </Section>
          <Section title="Top 10 produktów">
            <AnalyticsTable
              compact
              rank
              params={params}
              rows={topProducts}
              columns={[
                { key: "sublabel", header: "Produkt", type: "text", grow: true },
                { key: "items_qty", header: "Sztuk", type: "number", align: "right" },
                { key: "net_pln", header: "Przychód netto PLN", type: "money", align: "right" },
                { key: "share_pct", header: "Udział", type: "share", align: "right" },
              ]}
            />
          </Section>
        </div>
        <Note>
          Dane od {String(kpi.first_order).slice(0, 10)} do {String(kpi.last_order).slice(0, 10)}. Średnio{" "}
          {Number(kpi.avg_items_per_order).toLocaleString("pl-PL")} szt. na zamówienie. Kwoty przeliczone na PLN kursem
          NBP z dnia poprzedzającego zamówienie. CoGS pochodzi z dokumentów przyjęć wFirma, liczony metodą EASI
          (cena z pierwszego przyjęcia towaru) - koszt jest więc zamrożony na kwietniu 2026 i nie odzwierciedla
          zmian cen zakupu w czasie. Kwota VAT celowo nie jest pokazywana jako wskaźnik: Turis wypełnia ją także
          dla eksportu z odwrotnym obciążeniem, gdzie podatku nie naliczono (docs/analiza-easi/LUKI-DANYCH.md).
        </Note>
      </>
    );
  }

  if (report === "struktura") {
    const blocks = await Promise.all(
      STRUCTURE_BLOCKS.map(async (b) => ({ ...b, rows: translateRows(b.dim, await getOrdersBy(b.dim, { ...filters, limit: 100 })) })),
    );
    return (
      <>
        <div className="grid gap-4 lg:grid-cols-2">
          {blocks.map((b) => (
            <Section key={b.dim} title={b.title}>
              <AnalyticsTable compact params={params} rows={b.rows} columns={STRUCTURE_COLUMNS} />
            </Section>
          ))}
        </div>
        <Note>{def.hint}</Note>
      </>
    );
  }

  if (report === "uspieni") {
    const rows = await getDormant(days, filters.limit ?? 100, filters.agent);
    return (
      <>
        <div className="border border-gold bg-white">
          <AnalyticsTable params={params} rows={rows} columns={def.columns ?? []} rank />
        </div>
        <Note>{def.hint}</Note>
      </>
    );
  }

  const rows =
    report === "produkty"
      ? await getProducts(filters)
      : await getOrdersBy(report === "okresy" ? period : def.dim!, filters);

  return (
    <>
      <div className="border border-gold bg-white">
        <AnalyticsTable params={params} rows={rows} columns={def.columns ?? []} rank={report !== "okresy"} />
      </div>
      <Note>
        {def.hint}
        {rows.length >= (filters.limit ?? 100) && " Lista jest ucięta do wybranej liczby pozycji - zmień ją w polu „Pokaż”."}
      </Note>
    </>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 max-w-4xl text-xs leading-relaxed text-plum/60">{children}</p>;
}

function Empty() {
  return <div className="border border-gold bg-white px-4 py-16 text-center text-plum/40">Brak danych dla tych filtrów</div>;
}

export function AnalyticsSkeleton() {
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-t-2 border-gold bg-white px-4 py-3">
            <div className="h-3 w-24 animate-pulse bg-sand" />
            <div className="mt-2 h-5 w-32 animate-pulse bg-cream" />
          </div>
        ))}
      </div>
      <div className="h-64 animate-pulse border border-gold bg-white" />
    </>
  );
}
