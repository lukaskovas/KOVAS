import Link from "next/link";
import { Suspense } from "react";
import Shell from "../shell";
import AnalyticsView, { AnalyticsSkeleton } from "../analytics-view";
import AnalyticsFilters, { type Preset } from "../analytics-filters";
import { getFilterOptions } from "@/lib/queries";
import { PERIODS, REPORTS, isPeriod, isReportKey, type AnalyticsFilters as AF } from "@/lib/analytics";
import { requireUser } from "@/lib/auth";

// Patrz app/page.tsx: zimne agregaty (report_kpi, sumy po pozycjach) przekraczają domyślny
// limit funkcji Vercela i wywalają stronę. Podnosimy limit, żeby zimny start się dokończył.
export const maxDuration = 60;

/**
 * Zakładka "Raporty" - agregaty (kto kupuje najwięcej, co się sprzedaje, jak idzie w czasie).
 * Uzupełnienie raportów szczegółowych z "/", które pokazują pojedyncze zamówienia i pozycje.
 *
 * Cały stan siedzi w URL-u (zakładka, filtry, sortowanie, limit), więc konkretny widok
 * da się zabookmarkować i wysłać linkiem - tak samo jak raporty szczegółowe.
 */

type SearchParams = {
  r?: string; okres?: string; q?: string; from?: string; to?: string;
  currency?: string; status?: string; country?: string; agent?: string; ctype?: string;
  sort?: string; dir?: string; limit?: string; dni?: string; typ?: string;
};

/** Typy dokumentu dla raportu dostaw. "all" = oba typy (brak filtra po stronie SQL). */
const DELIVERY_TYPES = [
  { key: "PZ", label: "Przyjęcia zewnętrzne (PZ)" },
  { key: "PW", label: "Przyjęcia wewnętrzne (PW)" },
  { key: "all", label: "Oba typy" },
] as const;

/** Gotowe zakresy dat - najczęstsze pytania zarządu bez klikania w kalendarz. */
function buildPresets(from: string | undefined, to: string | undefined, base: URLSearchParams): Preset[] {
  const today = new Date();
  const y = today.getUTCFullYear();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const yearAgo = new Date(Date.UTC(y - 1, today.getUTCMonth(), today.getUTCDate()));

  const defs: { label: string; from?: string; to?: string }[] = [
    { label: "Cała historia" },
    { label: "Ten rok", from: `${y}-01-01` },
    { label: "Poprzedni rok", from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
    { label: "Ostatnie 12 mies.", from: iso(yearAgo) },
    { label: "Ten miesiąc", from: iso(new Date(Date.UTC(y, today.getUTCMonth(), 1))) },
  ];

  return defs.map((d) => {
    const params = new URLSearchParams(base);
    params.delete("from");
    params.delete("to");
    if (d.from) params.set("from", d.from);
    if (d.to) params.set("to", d.to);
    return {
      label: d.label,
      href: `/raporty?${params.toString()}`,
      active: (from ?? "") === (d.from ?? "") && (to ?? "") === (d.to ?? ""),
    };
  });
}

export default async function Raporty({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const clean = (v?: string) => v?.trim() || undefined;

  const report = isReportKey(sp.r) ? sp.r : "podsumowanie";
  const period = isPeriod(sp.okres) ? sp.okres : "month";
  const days = Math.max(1, Number(sp.dni ?? 90) || 90);
  const limit = Math.min(5000, Math.max(1, Number(sp.limit ?? 100) || 100));

  // Raport dostaw: domyślnie PZ (przyjęcia zewnętrzne - to o co pytała Katia w pierwszej kolejności).
  const deliveryType = sp.typ === "PW" ? "PW" : sp.typ === "all" ? "all" : "PZ";

  const filters: AF = {
    from: clean(sp.from),
    to: clean(sp.to),
    currency: clean(sp.currency),
    status: clean(sp.status),
    country: clean(sp.country),
    agent: clean(sp.agent),
    ctype: clean(sp.ctype),
    type: report === "dostawy" && deliveryType !== "all" ? deliveryType : undefined,
    q: clean(sp.q),
    sort: clean(sp.sort),
    dir: sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : undefined,
    limit,
  };

  // Parametry przekazywane dalej do linków sortujących, presetów i eksportu - inaczej
  // kliknięcie w nagłówek kolumny gubiłoby ustawione filtry.
  const params: Record<string, string | undefined> = {
    r: report,
    okres: report === "okresy" ? period : undefined,
    dni: report === "uspieni" ? String(days) : undefined,
    typ: report === "dostawy" ? deliveryType : undefined,
    q: filters.q,
    from: filters.from,
    to: filters.to,
    currency: filters.currency,
    status: filters.status,
    country: filters.country,
    agent: filters.agent,
    ctype: filters.ctype,
    sort: filters.sort,
    dir: filters.dir,
    limit: sp.limit,
  };
  const qs = (extra: Record<string, string | undefined> = {}) => {
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...params, ...extra })) if (v) out.set(k, String(v));
    return out;
  };

  const options = await getFilterOptions();

  return (
    <Shell active="raporty" user={user}>
      {/* Wybór raportu - druga warstwa nawigacji, pod zakładkami głównymi */}
      <nav className="mb-4 flex flex-wrap gap-2">
        {REPORTS.map((r) => {
          const active = r.key === report;
          // zmiana raportu czyści sortowanie: kolumny są inne w każdym raporcie
          const href = `/raporty?${qs({ r: r.key, sort: undefined, dir: undefined, okres: undefined, dni: undefined }).toString()}`;
          return (
            <Link
              key={r.key}
              href={href}
              prefetch
              className={`border px-4 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                active ? "border-plum bg-plum text-cream" : "border-gold bg-white text-plum hover:bg-sand"
              }`}
            >
              {r.label}
            </Link>
          );
        })}
      </nav>

      <AnalyticsFilters
        hidden={{ r: report, okres: params.okres, dni: params.dni, typ: params.typ, sort: filters.sort, dir: filters.dir }}
        active={{ ...filters, limit: sp.limit }}
        options={options}
        presets={buildPresets(filters.from, filters.to, qs())}
        showLimit={report !== "podsumowanie" && report !== "struktura"}
        exportHref={`/api/export-report?${qs().toString()}`}
        clearHref={`/raporty?r=${report}`}
      />

      {report === "okresy" && (
        <div className="mb-4 inline-flex border border-gold bg-white">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={`/raporty?${qs({ okres: p.key }).toString()}`}
              className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                p.key === period ? "bg-plum text-cream" : "text-plum hover:bg-sand"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      )}

      {report === "dostawy" && (
        <div className="mb-4 inline-flex border border-gold bg-white">
          {DELIVERY_TYPES.map((t) => (
            <Link
              key={t.key}
              href={`/raporty?${qs({ typ: t.key, sort: undefined, dir: undefined }).toString()}`}
              className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider transition ${
                t.key === deliveryType ? "bg-plum text-cream" : "text-plum hover:bg-sand"
              }`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}

      {report === "uspieni" && (
        <div className="mb-4 inline-flex items-center gap-2">
          <span className="text-xs uppercase tracking-wider text-plum/50">Bez zamówienia od</span>
          {[30, 60, 90, 180, 365].map((d) => (
            <Link
              key={d}
              href={`/raporty?${qs({ dni: String(d) }).toString()}`}
              className={`border px-3 py-1 text-xs font-medium transition ${
                d === days ? "border-plum bg-plum text-cream" : "border-gold bg-white text-plum hover:bg-sand"
              }`}
            >
              {d} dni
            </Link>
          ))}
        </div>
      )}

      <Suspense key={JSON.stringify({ report, period, days, filters })} fallback={<AnalyticsSkeleton />}>
        <AnalyticsView report={report} period={period} filters={filters} params={params} days={days} />
      </Suspense>
    </Shell>
  );
}
