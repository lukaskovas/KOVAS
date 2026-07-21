"use client";

import { useState } from "react";
import type { FilterOptions } from "@/lib/queries";
import type { ReportView } from "@/lib/report-columns";
import Dropdown from "./dropdown";
import { matchLabel, orderStatusLabel } from "@/lib/labels";

/**
 * Pasek filtrów. Nawiguje zwykłym formularzem GET - filtry lądują w URL-u,
 * więc widok da się zabookmarkować i wysłać komuś linkiem, a eksport CSV
 * dostaje dokładnie te same parametry co ekran.
 */

export type ActiveFilters = {
  q?: string;
  from?: string;
  to?: string;
  status?: string;
  currency?: string;
  match?: string;
  country?: string;
  agent?: string;
  ctype?: string;
  sort?: string;
  dir?: string;
};

const inputCls =
  "border border-gold bg-white px-3 py-1.5 text-sm text-ink outline-none transition focus:border-plum";

/**
 * `translate` mapuje techniczną wartość z bazy na polską etykietę. Wartość wysyłana
 * w formularzu zostaje surowa - inaczej filtr przestałby pasować do danych.
 */
function Select({
  name,
  value,
  label,
  options,
  translate,
}: {
  name: string;
  value?: string;
  label: string;
  options: string[];
  translate?: (v: string) => string;
}) {
  return (
    <Dropdown
      name={name}
      value={value}
      placeholder={`${label}: wszystkie`}
      options={options.map((o) => ({ value: o, label: translate ? translate(o) : o }))}
    />
  );
}

export default function Filters({
  view,
  active,
  options,
  total,
}: {
  view: ReportView;
  active: ActiveFilters;
  options: FilterOptions;
  total: number;
}) {
  const hasFilters = Boolean(
    active.q || active.from || active.to || active.status || active.currency || active.match ||
    active.country || active.agent || active.ctype,
  );
  const [open, setOpen] = useState(hasFilters);

  const exportParams = new URLSearchParams({ view });
  for (const [k, v] of Object.entries(active)) if (v) exportParams.set(k, String(v));

  return (
    <div className="border-b border-sand bg-cream/60">
      <form action="/" method="GET" className="flex flex-wrap items-center gap-2 p-3">
        <input type="hidden" name="view" value={view} />
        {active.sort && <input type="hidden" name="sort" value={active.sort} />}
        {active.dir && <input type="hidden" name="dir" value={active.dir} />}

        <input
          name="q"
          defaultValue={active.q}
          placeholder="Szukaj..."
          className={`${inputCls} w-56`}
        />

        <button type="button" onClick={() => setOpen((o) => !o)} className={`${inputCls} font-medium text-plum hover:bg-sand`}>
          Filtry {hasFilters ? "•" : ""} {open ? "▲" : "▼"}
        </button>

        {open && (
          <>
            {view !== "companies" && (
              <>
                <label className="flex items-center gap-1.5 text-sm text-plum/60">
                  od
                  <input type="date" name="from" defaultValue={active.from} className={inputCls} />
                </label>
                <label className="flex items-center gap-1.5 text-sm text-plum/60">
                  do
                  <input type="date" name="to" defaultValue={active.to} className={inputCls} />
                </label>
                <Select name="currency" value={active.currency} label="Waluta" options={options.currencies} />
              </>
            )}
            {view === "orders" && (
              <>
                <Select name="status" value={active.status} label="Status" options={options.statuses} translate={orderStatusLabel} />
                <Select name="match" value={active.match} label="Dopasowanie" options={options.matches} translate={matchLabel} />
              </>
            )}
            {view === "companies" && <Select name="country" value={active.country} label="Kraj" options={options.countries} />}
            {/* Handlowiec i typ klienta są atrybutem kontrahenta (kartoteka EASI, migracja 0011),
                więc mają sens na zamówieniach i na kontrahentach - nie na pozycjach zamówień,
                bo widok v_order_items_report tych kolumn nie ma. */}
            {view !== "products" && (
              <>
                <Select name="agent" value={active.agent} label="Handlowiec" options={options.agents} />
                <Select name="ctype" value={active.ctype} label="Typ klienta" options={options.ctypes} />
              </>
            )}
          </>
        )}

        <button type="submit" className="bg-plum px-4 py-2 text-xs font-semibold uppercase tracking-wider text-cream transition hover:bg-plum-light">
          Zastosuj
        </button>
        {hasFilters && (
          <a href={`/?view=${view}`} className="text-sm text-plum/50 underline-offset-2 hover:text-plum hover:underline">
            wyczyść
          </a>
        )}

        <span className="ml-auto inline-flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-plum/50">
            Eksport ({total.toLocaleString("pl-PL")})
          </span>
          <a
            href={`/api/export?${exportParams.toString()}`}
            className="inline-flex items-center gap-1.5 border border-plum bg-transparent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-plum transition hover:bg-plum hover:text-cream"
          >
            CSV
          </a>
          <a
            href={`/api/export?${exportParams.toString()}&format=xlsx`}
            className="inline-flex items-center gap-1.5 border border-plum bg-transparent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-plum transition hover:bg-plum hover:text-cream"
          >
            Excel
          </a>
        </span>
      </form>
    </div>
  );
}
