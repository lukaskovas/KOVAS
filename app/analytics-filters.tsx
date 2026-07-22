"use client";

import type { FilterOptions } from "@/lib/queries";
import Dropdown from "./dropdown";
import DatePicker from "./date-picker";
import { orderStatusLabel } from "@/lib/labels";

/**
 * Pasek filtrów raportów zbiorczych. Osobny od app/filters.tsx, bo obsługuje inny zestaw
 * pól (bez "dopasowania faktur", za to z limitem TOP N) i nawiguje do /raporty.
 * Tak jak tam: zwykły formularz GET, więc stan raportu siedzi w URL-u i da się go wysłać linkiem.
 */

const inputCls = "border border-gold bg-white px-3 py-1.5 text-sm text-ink outline-none transition focus:border-plum";

export type Preset = { label: string; href: string; active: boolean };

export default function AnalyticsFilters({
  hidden,
  active,
  options,
  presets,
  showLimit,
  exportHref,
  clearHref,
}: {
  /** Pola trzymające kontekst zakładki (r, okres, sort, dir) - inaczej formularz by je zgubił. */
  hidden: Record<string, string | undefined>;
  active: {
    q?: string; from?: string; to?: string; currency?: string; status?: string; country?: string;
    agent?: string; ctype?: string; limit?: string;
  };
  options: FilterOptions;
  presets: Preset[];
  showLimit: boolean;
  exportHref: string;
  clearHref: string;
}) {
  const hasFilters = Boolean(
    active.q || active.from || active.to || active.currency || active.status || active.country || active.agent || active.ctype,
  );

  return (
    <div className="mb-4 border border-gold bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-sand px-3 py-2">
        <span className="font-display text-xs uppercase tracking-wider text-plum/50">Okres</span>
        {presets.map((p) => (
          <a
            key={p.label}
            href={p.href}
            className={`border px-3 py-1 text-xs font-medium transition ${
              p.active ? "border-plum bg-plum text-cream" : "border-gold bg-white text-plum hover:bg-sand"
            }`}
          >
            {p.label}
          </a>
        ))}
      </div>

      <form action="/raporty" method="GET" className="flex flex-wrap items-center gap-2 p-3">
        {Object.entries(hidden).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}

        <input name="q" defaultValue={active.q} placeholder="Szukaj kontrahenta / nr zamówienia..." className={`${inputCls} w-64`} />
        <span className="flex items-center gap-1.5 text-sm text-plum/60">
          od
          <DatePicker name="from" value={active.from} placeholder="od" />
        </span>
        <span className="flex items-center gap-1.5 text-sm text-plum/60">
          do
          <DatePicker name="to" value={active.to} placeholder="do" />
        </span>

        <Dropdown name="currency" value={active.currency} placeholder="Waluta: wszystkie" options={options.currencies.map((o) => ({ value: o, label: o }))} />
        <Dropdown
          name="status"
          value={active.status}
          placeholder="Status: wszystkie"
          options={options.statuses.map((o) => ({ value: o, label: orderStatusLabel(o) }))}
        />
        <Dropdown name="country" value={active.country} placeholder="Kraj: wszystkie" options={options.countries.map((o) => ({ value: o, label: o }))} />
        {/* "(brak)" to jawna wartość filtra, nie pusty wybór - pozwala pokazać sprzedaż
            kontrahentów, których nie ma w kartotece EASI (patrz migracja 0011). */}
        <Dropdown
          name="agent"
          value={active.agent}
          placeholder="Handlowiec: wszyscy"
          options={[...options.agents.map((o) => ({ value: o, label: o })), { value: "(brak)", label: "(brak handlowca)" }]}
        />
        <Dropdown
          name="ctype"
          value={active.ctype}
          placeholder="Typ klienta: wszystkie"
          options={[...options.ctypes.map((o) => ({ value: o, label: o })), { value: "(brak)", label: "(brak typu)" }]}
        />

        {showLimit && (
          <Dropdown
            name="limit"
            value={active.limit}
            placeholder="Pokaż: 100"
            options={[
              { value: "25", label: "Pokaż: 25" },
              { value: "100", label: "Pokaż: 100" },
              { value: "500", label: "Pokaż: 500" },
              { value: "5000", label: "Pokaż: wszystko" },
            ]}
          />
        )}

        <button type="submit" className="bg-plum px-4 py-2 text-xs font-semibold uppercase tracking-wider text-cream transition hover:bg-plum-light">
          Zastosuj
        </button>
        {hasFilters && (
          <a href={clearHref} className="text-sm text-plum/50 underline-offset-2 hover:text-plum hover:underline">
            wyczyść
          </a>
        )}

        <span className="ml-auto inline-flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-plum/50">Eksport</span>
          <a
            href={exportHref}
            className="inline-flex items-center gap-1.5 border border-plum bg-transparent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-plum transition hover:bg-plum hover:text-cream"
          >
            CSV
          </a>
          <a
            href={`${exportHref}&format=xlsx`}
            className="inline-flex items-center gap-1.5 border border-plum bg-transparent px-4 py-2 text-xs font-semibold uppercase tracking-wider text-plum transition hover:bg-plum hover:text-cream"
          >
            Excel
          </a>
        </span>
      </form>
    </div>
  );
}
