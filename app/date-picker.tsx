"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Własny date picker zamiast <input type="date">. Natywny kalendarz jest rysowany przez
 * przeglądarkę (niebieskie systemowe okno) i CSS go nie dosięga - stąd own component, żeby
 * wybór daty wyglądał jak reszta panelu. Wartość jedzie w ukrytym inpucie w formacie
 * YYYY-MM-DD (identycznym jak natywny input), więc formularz GET działa dokładnie tak samo.
 */

const MONTHS = [
  "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
  "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
];
const WEEKDAYS = ["Pn", "Wt", "Śr", "Cz", "Pt", "So", "Nd"];

/** Lokalny YYYY-MM-DD - bez toISOString(), które przesuwa datę o strefę. */
function toKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Parsuje YYYY-MM-DD do lokalnej daty (bez strefowego przesunięcia new Date("...")). */
function fromKey(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export default function DatePicker({
  name,
  value,
  placeholder = "Wybierz datę",
}: {
  name: string;
  value?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value ?? "");
  const [view, setView] = useState(() => fromKey(value ?? "") ?? new Date());
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

  const openPicker = () => {
    setView(fromKey(selected) ?? new Date());
    setOpen((o) => !o);
  };

  const pick = (d: Date) => {
    setSelected(toKey(d));
    setOpen(false);
  };

  // Siatka: poniedziałek jako pierwszy dzień tygodnia (getDay(): 0=Nd -> przesuwamy).
  const first = new Date(view.getFullYear(), view.getMonth(), 1);
  const lead = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(1 - lead);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });

  const todayKey = toKey(new Date());

  return (
    <div ref={box} className="relative inline-block">
      <input type="hidden" name={name} value={selected} />
      <button
        type="button"
        onClick={openPicker}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex min-w-36 items-center justify-between gap-3 border bg-white px-3 py-1.5 text-left text-sm transition ${
          selected ? "border-plum text-plum" : "border-gold text-ink"
        } hover:border-plum`}
      >
        <span className="truncate">{selected || placeholder}</span>
        <span className="text-xs text-gold-deep">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 w-64 border-2 border-gold bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))}
              className="px-2 py-1 text-sm text-plum transition hover:bg-sand"
              aria-label="Poprzedni miesiąc"
            >
              ‹
            </button>
            <span className="font-display text-sm font-semibold capitalize text-plum">
              {MONTHS[view.getMonth()]} {view.getFullYear()}
            </span>
            <button
              type="button"
              onClick={() => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))}
              className="px-2 py-1 text-sm text-plum transition hover:bg-sand"
              aria-label="Następny miesiąc"
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-7 gap-0.5 text-center">
            {WEEKDAYS.map((w) => (
              <span key={w} className="py-1 text-xs font-semibold text-plum/40">{w}</span>
            ))}
            {cells.map((d) => {
              const key = toKey(d);
              const inMonth = d.getMonth() === view.getMonth();
              const isSelected = key === selected;
              const isToday = key === todayKey;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => pick(d)}
                  className={`py-1.5 text-sm transition ${
                    isSelected
                      ? "bg-plum text-cream"
                      : isToday
                        ? "text-plum ring-1 ring-inset ring-plum"
                        : inMonth
                          ? "text-ink hover:bg-sand"
                          : "text-plum/25 hover:bg-sand"
                  }`}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-sand pt-2 text-xs">
            <button
              type="button"
              onClick={() => { setSelected(""); setOpen(false); }}
              className="text-plum/60 underline-offset-2 hover:text-plum hover:underline"
            >
              Wyczyść
            </button>
            <button
              type="button"
              onClick={() => pick(new Date())}
              className="text-plum underline-offset-2 hover:underline"
            >
              Dziś
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
