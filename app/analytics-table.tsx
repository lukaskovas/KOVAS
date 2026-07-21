"use client";

import Link from "next/link";
import { fmtMoney, fmtDate, txt } from "@/lib/format";
import type { AggColumn, AggRow } from "@/lib/analytics";

/**
 * Tabela raportu zbiorczego. Osobna od app/table-client.tsx, bo pokazuje co innego:
 * agregaty z paskiem udziału i zmianą do poprzedniego okresu, bez przełącznika kolumn
 * (wierszy jest kilkadziesiąt, nie 89 tysięcy).
 *
 * Sortowanie jest SERWEROWE - nagłówek to link zmieniający ?sort=&dir=. To istotne, bo
 * lista jest ucięta do TOP N: posortowanie tylko widocznych wierszy pokazywałoby
 * "największych" wybranych z i tak już obciętej listy.
 */

function Share({ value }: { value: number | null | undefined }) {
  const pct = Number(value) || 0;
  return (
    <span className="inline-flex items-center justify-end gap-2">
      <span className="h-1.5 w-16 bg-sand" aria-hidden>
        <span className="block h-full bg-gold-deep" style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <span className="w-12 text-right tabular-nums">{pct.toFixed(1)}%</span>
    </span>
  );
}

function Change({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-plum/25">-</span>;
  const n = Number(value);
  const cls = n > 0 ? "text-emerald-700" : n < 0 ? "text-rose-700" : "text-plum/60";
  return (
    <span className={`font-medium tabular-nums ${cls}`}>
      {n > 0 ? "+" : ""}
      {n.toFixed(1)}%
    </span>
  );
}

function renderCell(row: AggRow, col: AggColumn) {
  const v = (row as Record<string, unknown>)[col.key as string];
  switch (col.type) {
    case "money":
      return <span className="font-medium text-plum-dark">{fmtMoney(v)}</span>;
    case "number":
      return <span className="tabular-nums">{(Number(v) || 0).toLocaleString("pl-PL")}</span>;
    case "share":
      return <Share value={v as number} />;
    case "change":
      return <Change value={v as number | null} />;
    case "days": {
      const d = Number(v) || 0;
      // powyżej roku cisza to inna kategoria problemu niż kwartał - warto, by rzucało się w oczy
      const cls = d > 365 ? "text-rose-700" : d > 180 ? "text-amber-700" : "text-plum/70";
      return <span className={`font-medium tabular-nums ${cls}`}>{d.toLocaleString("pl-PL")}</span>;
    }
    case "date":
      return <span className="text-plum/60">{v ? String(v).slice(0, 10) : fmtDate(v)}</span>;
    case "mono":
      return <span className="font-mono text-xs text-plum/60">{txt(v)}</span>;
    default:
      return (
        <span className={`block truncate ${col.grow ? "max-w-[26rem]" : ""} ${!v ? "text-plum/25" : ""}`} title={v ? String(v) : undefined}>
          {txt(v)}
        </span>
      );
  }
}

export default function AnalyticsTable({
  columns,
  rows,
  params,
  rank,
  compact,
}: {
  columns: AggColumn[];
  rows: AggRow[];
  /** Aktualne parametry URL - link sortujący musi zachować filtry i wybraną zakładkę. */
  params: Record<string, string | undefined>;
  /** Numeracja pozycji - przy rankingach ("kto jest trzeci") czyta się to dużo szybciej. */
  rank?: boolean;
  compact?: boolean;
}) {
  function sortHref(sortKey: string) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) next.set(k, v);
    const active = params.sort === sortKey;
    next.set("sort", sortKey);
    next.set("dir", active && params.dir === "desc" ? "asc" : "desc");
    return `/raporty?${next.toString()}`;
  }

  const pad = compact ? "px-3 py-2" : "px-3 py-2.5";

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-gold bg-cream">
            {rank && <th className="w-10 px-3 py-3" />}
            {columns.map((c) => {
              const active = c.sort && params.sort === c.sort;
              const arrow = active ? (params.dir === "asc" ? "↑" : "↓") : "↕";
              return (
                <th
                  key={String(c.key)}
                  className={`font-display whitespace-nowrap bg-cream px-3 py-3 text-xs font-semibold uppercase tracking-wider text-plum ${
                    c.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  {c.sort ? (
                    <Link
                      href={sortHref(c.sort)}
                      scroll={false}
                      className={`inline-flex items-center gap-1 transition hover:text-plum-light ${c.align === "right" ? "flex-row-reverse" : ""}`}
                    >
                      {c.header}
                      <span className={active ? "text-gold-deep" : "text-gold"}>{arrow}</span>
                    </Link>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (rank ? 1 : 0)} className="px-4 py-16 text-center text-plum/40">
                Brak danych dla tych filtrów
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={`${r.label}-${i}`} className="border-b border-sand transition-colors last:border-0 hover:bg-cream">
                {rank && <td className={`${pad} text-right text-xs tabular-nums text-plum/40`}>{i + 1}</td>}
                {columns.map((c) => (
                  <td
                    key={String(c.key)}
                    className={`${pad} text-ink ${c.align === "right" ? "text-right tabular-nums" : "text-left"} ${c.grow ? "" : "whitespace-nowrap"}`}
                  >
                    {renderCell(r, c)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
