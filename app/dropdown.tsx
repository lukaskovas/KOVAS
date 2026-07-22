"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Własny dropdown zamiast <select>. Natywna lista opcji jest rysowana przez system
 * (na macOS ciemne menu) i CSS jej nie dosięga - stąd own component, żeby filtry
 * wyglądały jak reszta panelu. Wartość jedzie w ukrytym inpucie, więc formularz
 * GET działa dokładnie tak samo jak wcześniej.
 */

export type Option = { value: string; label: string };

/** Ile dopasowań renderujemy naraz przy wyszukiwaniu - kontrahentów jest ~1,3 tys.,
 *  a wrzucenie wszystkich do DOM-u przy każdym otwarciu niepotrzebnie zamula. */
const SEARCH_LIMIT = 100;

export default function Dropdown({
  name,
  value,
  placeholder,
  options,
  searchable = false,
  includeEmpty = true,
}: {
  name: string;
  value?: string;
  placeholder: string;
  options: Option[];
  /** Dokłada pole wyszukiwania i filtruje listę - dla długich list (kontrahenci). */
  searchable?: boolean;
  /** Dokłada pustą opcję "placeholder" na górze listy (dla filtrów typu "wszyscy").
   *  Wyłącz dla pól, które zawsze mają wartość - np. wybór roli. */
  includeEmpty?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value ?? "");
  const [query, setQuery] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === selected);

  const q = query.trim().toLowerCase();
  const filtered = searchable && q
    ? options.filter((o) => o.label.toLowerCase().includes(q))
    : options;
  const shown = searchable ? filtered.slice(0, SEARCH_LIMIT) : filtered;
  const overflow = searchable ? filtered.length - shown.length : 0;

  return (
    <div ref={box} className="relative">
      <input type="hidden" name={name} value={selected} />
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setQuery(""); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex min-w-44 items-center justify-between gap-3 border bg-white px-3 py-1.5 text-left text-sm transition ${
          selected ? "border-plum text-plum" : "border-gold text-ink"
        } hover:border-plum`}
      >
        <span className="truncate">{current ? current.label : placeholder}</span>
        <span className="text-xs text-gold-deep">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 min-w-full border-2 border-gold bg-white shadow-lg">
          {searchable && (
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj kontrahenta..."
              className="block w-full border-b border-sand bg-cream px-3 py-2 text-sm text-ink outline-none placeholder:text-plum/40"
            />
          )}
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {(includeEmpty ? [{ value: "", label: placeholder }, ...shown] : shown).map((o) => {
              const active = o.value === selected;
              return (
                <li key={o.value || "__all"} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onClick={() => { setSelected(o.value); setOpen(false); setQuery(""); }}
                    className={`block w-full whitespace-nowrap px-3 py-1.5 text-left text-sm transition ${
                      active ? "bg-plum text-cream" : "text-ink hover:bg-sand"
                    }`}
                  >
                    {o.label}
                  </button>
                </li>
              );
            })}
            {searchable && shown.length === 0 && (
              <li className="px-3 py-1.5 text-sm text-plum/50">Brak dopasowań</li>
            )}
            {overflow > 0 && (
              <li className="px-3 py-1.5 text-xs text-plum/50">
                ...i jeszcze {overflow.toLocaleString("pl-PL")} - zawęź wyszukiwanie
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
