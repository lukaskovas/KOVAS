"use client";

import Link from "next/link";
import { fmtMoney, fmtDate, txt } from "@/lib/format";
import ColumnPicker, { isVisible, useColumnVisibility } from "./column-picker";
import { matchLabel, orderStatusLabel } from "@/lib/labels";
import type { Column, ReportView } from "@/lib/report-columns";

export type Row = Record<string, unknown>;

/**
 * Tabela raportu. Sortowanie jest SERWEROWE - nagłówek to link zmieniający ?sort=&dir=,
 * więc obejmuje cały zbiór w bazie, nie tylko widoczne 100 wierszy (wcześniej sortowało
 * lokalnie i mylnie sugerowało, że pokazuje globalnie największe wartości).
 */

/** `label` to polska wersja; kolor dobieramy z surowej wartości, bo to ona jest stabilna. */
function StatusBadge({ status, label }: { status: string | null; label: string }) {
  if (!status) return <span className="text-plum/25">-</span>;
  const s = status.toLowerCase();
  let cls = "bg-cream text-plum/70 ring-gold";
  if (/(shipped|completed|complete|paid|done|zrealizow|opłac|wysłan|^matched$)/.test(s)) cls = "bg-emerald-50 text-emerald-700 ring-emerald-200";
  else if (/(pending|new|await|oczek|nowe|processing|completing|ambiguous)/.test(s)) cls = "bg-amber-50 text-amber-700 ring-amber-200";
  else if (/(cancel|anulow|reject|error|błąd|failed|zwrot|unmatched|unparseable)/.test(s)) cls = "bg-rose-50 text-rose-700 ring-rose-200";
  return <span className={`inline-flex items-center px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cls}`}>{label}</span>;
}

function renderCell(row: Row, col: Column) {
  const v = row[col.key];
  switch (col.type) {
    case "status": {
      const raw = (v as string) ?? null;
      const toLabel = col.key === "invoice_match_status" ? matchLabel : orderStatusLabel;
      return <StatusBadge status={raw} label={toLabel(raw)} />;
    }
    case "money":
      return <span className="font-medium text-plum-dark">{fmtMoney(v, col.currencyKey ? (row[col.currencyKey] as string) : null)}</span>;
    case "percent":
      return v || v === 0 ? `${txt(v)}%` : "-";
    case "date":
      return <span className="text-plum/60">{fmtDate(v)}</span>;
    case "mono":
      return <span className="font-mono text-xs text-plum/60">{txt(v)}</span>;
    case "strong":
      return <span className="font-medium text-plum-dark">{txt(v)}</span>;
    case "number":
      return txt(v);
    default:
      return (
        <span className={`block truncate ${col.grow ? "max-w-[22rem]" : ""} ${!v ? "text-plum/25" : ""}`} title={v ? String(v) : undefined}>
          {txt(v)}
        </span>
      );
  }
}

export default function TableClient({
  view,
  columns,
  rows,
  params,
  note,
}: {
  view: ReportView;
  columns: Column[];
  rows: Row[];
  /** Aktualne parametry URL - potrzebne, by link sortujący zachował filtry i wyszukiwanie. */
  params: Record<string, string | undefined>;
  note?: string;
}) {
  const [vis, setVis] = useColumnVisibility(view);
  const visible = columns.filter((c) => isVisible(c, vis));

  function sortHref(sortKey: string) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") next.set(k, v);
    next.set("view", view);
    const active = params.sort === sortKey;
    next.set("sort", sortKey);
    next.set("dir", active && params.dir === "asc" ? "desc" : "asc");
    return `/?${next.toString()}`;
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b border-sand px-3 py-2">
        <span className="text-xs text-plum/50">
          {visible.length} z {columns.length} kolumn
          <span className="ml-2 text-plum/35">eksport CSV zawsze zawiera wszystkie</span>
        </span>
        <ColumnPicker columns={columns} vis={vis} onChange={setVis} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-gold bg-cream">
              {visible.map((c) => {
                const active = c.sortKey && params.sort === c.sortKey;
                const arrow = active ? (params.dir === "asc" ? "↑" : "↓") : "↕";
                return (
                  <th
                    key={c.key}
                    className={`font-display sticky top-0 z-10 whitespace-nowrap bg-cream px-3 py-3 text-xs font-semibold uppercase tracking-wider text-plum ${c.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {c.sortKey ? (
                      <Link href={sortHref(c.sortKey)} scroll={false} className={`inline-flex items-center gap-1 transition hover:text-plum-light ${c.align === "right" ? "flex-row-reverse" : ""}`}>
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
            {visible.length === 0 ? (
              <tr><td className="px-4 py-16 text-center text-plum/40">Wszystkie kolumny ukryte - włącz je przyciskiem „Kolumny”</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={visible.length} className="px-4 py-16 text-center text-plum/40">Brak danych dla tych filtrów</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-b border-sand transition-colors last:border-0 hover:bg-cream">
                  {visible.map((c) => (
                    <td key={c.key} className={`px-3 py-2.5 text-ink ${c.align === "right" ? "text-right tabular-nums" : "text-left"} ${c.grow ? "" : "whitespace-nowrap"}`}>
                      {renderCell(r, c)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {note && <div className="border-t border-sand bg-cream px-4 py-2.5 text-xs text-plum/60">{note}</div>}
    </div>
  );
}
