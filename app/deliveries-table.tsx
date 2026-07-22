"use client";

import { useState } from "react";
import Link from "next/link";
import { fmtMoney } from "@/lib/format";
import type { DeliveryDoc } from "@/lib/analytics";

/**
 * Raport dostaw - tabela master-detail. Osobna od analytics-table.tsx, bo pokazuje co innego:
 * DOSTAWĘ (nagłówek dokumentu przyjęcia) rozwijaną do jej POZYCJI. Generyczna tabela agregatów
 * renderuje płaskie wiersze i tego nie obsłuży.
 *
 * Sortowanie nagłówków jest SERWEROWE (link zmienia ?sort=&dir=), jak w tabeli agregatów - lista
 * bywa ucięta do TOP N, więc sortowanie tylko widocznych wierszy pokazywałoby wybór z obciętej listy.
 * Rozwijanie pozycji jest LOKALNE (stan w przeglądarce) - pozycje przyjechały już z serwera w `items`.
 */

const HEAD =
  "font-display whitespace-nowrap bg-cream px-3 py-3 text-xs font-semibold uppercase tracking-wider text-plum";

type Col = { key: string; header: string; sort?: string; align?: "right"; grow?: boolean };

const COLS: Col[] = [
  { key: "receipt_date", header: "Data", sort: "date" },
  { key: "doc_number", header: "Nr dostawy", sort: "number" },
  { key: "doc_type", header: "Typ", sort: "type" },
  { key: "supplier", header: "Dostawca", sort: "supplier", grow: true },
  { key: "items_count", header: "Pozycji", sort: "count", align: "right" },
  { key: "items_qty", header: "Sztuk", sort: "qty", align: "right" },
  { key: "net_pln", header: "Wartość netto PLN", sort: "net", align: "right" },
  { key: "share_pct", header: "Udział", align: "right" },
];

function num(v: unknown): string {
  return (Number(v) || 0).toLocaleString("pl-PL");
}

export default function DeliveriesTable({
  rows,
  params,
}: {
  rows: DeliveryDoc[];
  /** Aktualne parametry URL - link sortujący musi zachować filtry, typ dokumentu i zakładkę. */
  params: Record<string, string | undefined>;
}) {
  const [open, setOpen] = useState<Set<number>>(new Set());

  function toggle(id: number) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function sortHref(sortKey: string) {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) next.set(k, v);
    const active = params.sort === sortKey;
    next.set("sort", sortKey);
    next.set("dir", active && params.dir === "desc" ? "asc" : "desc");
    return `/raporty?${next.toString()}`;
  }

  const colSpan = COLS.length + 1; // +1 za kolumnę z chevronem

  return (
    <div className="overflow-x-auto border border-gold bg-white">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b-2 border-gold bg-cream">
            <th className="w-8 px-3 py-3" />
            {COLS.map((c) => {
              const active = c.sort && params.sort === c.sort;
              const arrow = active ? (params.dir === "asc" ? "↑" : "↓") : "↕";
              return (
                <th key={c.key} className={`${HEAD} ${c.align === "right" ? "text-right" : "text-left"}`}>
                  {c.sort ? (
                    <Link
                      href={sortHref(c.sort)}
                      scroll={false}
                      className={`inline-flex items-center gap-1 transition hover:text-plum-light ${
                        c.align === "right" ? "flex-row-reverse" : ""
                      }`}
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
              <td colSpan={colSpan} className="px-4 py-16 text-center text-plum/40">
                Brak dostaw dla tych filtrów
              </td>
            </tr>
          ) : (
            rows.map((d) => {
              const expanded = open.has(d.doc_id);
              return (
                <DeliveryRow key={d.doc_id} d={d} expanded={expanded} onToggle={() => toggle(d.doc_id)} colSpan={colSpan} />
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function DeliveryRow({
  d,
  expanded,
  onToggle,
  colSpan,
}: {
  d: DeliveryDoc;
  expanded: boolean;
  onToggle: () => void;
  colSpan: number;
}) {
  const pct = Number(d.share_pct) || 0;
  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer border-b border-sand transition-colors last:border-0 hover:bg-cream ${
          expanded ? "bg-cream" : ""
        }`}
      >
        <td className="px-3 py-2.5 text-center text-gold-deep">{expanded ? "▾" : "▸"}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-plum/70">{String(d.receipt_date).slice(0, 10)}</td>
        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-plum-dark">{d.doc_number}</td>
        <td className="whitespace-nowrap px-3 py-2.5">
          <span className="border border-gold bg-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-plum/70">
            {d.doc_type}
          </span>
        </td>
        <td className="px-3 py-2.5 text-ink">
          <span className={`block truncate max-w-[24rem] ${!d.supplier ? "text-plum/25" : ""}`} title={d.supplier ?? undefined}>
            {d.supplier || "-"}
          </span>
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(d.items_count)}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{num(d.items_qty)}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium tabular-nums text-plum-dark">{fmtMoney(d.net_pln)}</td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right">
          <span className="inline-flex items-center justify-end gap-2">
            <span className="h-1.5 w-16 bg-sand" aria-hidden>
              <span className="block h-full bg-gold-deep" style={{ width: `${Math.min(100, pct)}%` }} />
            </span>
            <span className="w-12 text-right tabular-nums">{pct.toFixed(1)}%</span>
          </span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-sand bg-cream/40">
          <td />
          <td colSpan={colSpan - 1} className="px-3 pb-4 pt-1">
            <ItemsTable items={d.items} />
          </td>
        </tr>
      )}
    </>
  );
}

function ItemsTable({ items }: { items: DeliveryDoc["items"] }) {
  if (!items || items.length === 0) return <div className="py-2 text-xs text-plum/40">Brak pozycji</div>;
  return (
    <div className="overflow-x-auto border border-sand bg-white">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b border-sand bg-white text-plum/50">
            <th className="px-3 py-2 text-left font-display font-semibold uppercase tracking-wider">SKU</th>
            <th className="px-3 py-2 text-left font-display font-semibold uppercase tracking-wider">Marka</th>
            <th className="px-3 py-2 text-left font-display font-semibold uppercase tracking-wider">Nazwa towaru</th>
            <th className="px-3 py-2 text-left font-display font-semibold uppercase tracking-wider">EAN</th>
            <th className="px-3 py-2 text-right font-display font-semibold uppercase tracking-wider">Ilość</th>
            <th className="px-3 py-2 text-right font-display font-semibold uppercase tracking-wider">Cena jedn. netto</th>
            <th className="px-3 py-2 text-right font-display font-semibold uppercase tracking-wider">Wartość netto</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-b border-sand/60 last:border-0">
              <td className="whitespace-nowrap px-3 py-1.5 font-mono text-plum-dark">{it.sku || "-"}</td>
              <td className="whitespace-nowrap px-3 py-1.5">
                <span className={!it.brand ? "text-plum/25" : "text-ink"}>{it.brand || "-"}</span>
              </td>
              <td className="px-3 py-1.5 text-ink">
                <span className="block max-w-[22rem] truncate" title={it.name ?? undefined}>{it.name || "-"}</span>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 font-mono text-plum/50">{it.ean || "-"}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{num(it.qty)}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums">{fmtMoney(it.unit_price)}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right font-medium tabular-nums text-plum-dark">{fmtMoney(it.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
