"use client";

import { useEffect, useRef, useState } from "react";
import type { Column, ReportView } from "@/lib/report-columns";

/**
 * Panel wyboru widocznych kolumn (jak "Hide fields" w Airtable). Stan trzymamy w
 * localStorage per widok, a nie w URL-u - lista 33 kolumn rozdęłaby link, który ma
 * służyć do dzielenia się filtrami. Zapisujemy MAPĘ key->widoczna, nie listę ukrytych:
 * kolumna dodana w przyszłości nie ma wpisu i dziedziczy swoje domyślne `optional`.
 */

export type Visibility = Record<string, boolean>;

const storageKey = (view: ReportView) => `kovas.columns.${view}`;

export function isVisible(col: Column, vis: Visibility) {
  return col.key in vis ? vis[col.key] : !col.optional;
}

/** Czyta zapis dopiero po zamontowaniu - serwer renderuje domyślny układ, bez hydration mismatch. */
export function useColumnVisibility(view: ReportView) {
  const [vis, setVis] = useState<Visibility>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey(view));
      setVis(raw ? (JSON.parse(raw) as Visibility) : {});
    } catch {
      setVis({});
    }
  }, [view]);

  const update = (next: Visibility) => {
    setVis(next);
    try {
      localStorage.setItem(storageKey(view), JSON.stringify(next));
    } catch {
      // prywatny tryb przeglądarki - wybór zadziała, tylko nie przeżyje odświeżenia
    }
  };

  return [vis, update] as const;
}

export default function ColumnPicker({
  columns,
  vis,
  onChange,
}: {
  columns: Column[];
  vis: Visibility;
  onChange: (next: Visibility) => void;
}) {
  const [open, setOpen] = useState(false);
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

  const visibleCount = columns.filter((c) => isVisible(c, vis)).length;
  const q = query.trim().toLowerCase();
  const listed = q ? columns.filter((c) => c.header.toLowerCase().includes(q)) : columns;

  const setAll = (value: boolean) =>
    onChange(Object.fromEntries(columns.map((c) => [c.key, value])));

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="true"
        aria-expanded={open}
        className="border border-gold bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-plum transition hover:bg-sand"
      >
        Kolumny ({visibleCount}/{columns.length}) {open ? "▲" : "▼"}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1 w-72 border-2 border-gold bg-white shadow-lg">
          <div className="border-b border-sand p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Szukaj kolumny..."
              className="w-full border border-gold bg-white px-2 py-1.5 text-sm text-ink outline-none transition focus:border-plum"
            />
          </div>

          <ul className="max-h-80 overflow-y-auto py-1">
            {listed.length === 0 && (
              <li className="px-3 py-4 text-center text-sm text-plum/40">Brak kolumn</li>
            )}
            {listed.map((c) => {
              const on = isVisible(c, vis);
              return (
                <li key={c.key}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-ink transition hover:bg-sand">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => onChange({ ...vis, [c.key]: !on })}
                      className="h-3.5 w-3.5 accent-plum"
                    />
                    <span className="truncate">{c.header}</span>
                  </label>
                </li>
              );
            })}
          </ul>

          <div className="flex items-center justify-between border-t border-sand px-3 py-2 text-xs">
            <button type="button" onClick={() => setAll(true)} className="text-plum underline-offset-2 hover:underline">
              Pokaż wszystkie
            </button>
            <button type="button" onClick={() => setAll(false)} className="text-plum underline-offset-2 hover:underline">
              Ukryj wszystkie
            </button>
            <button type="button" onClick={() => onChange({})} className="text-plum/50 underline-offset-2 hover:text-plum hover:underline">
              Domyślne
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
