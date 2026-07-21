"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Własny dropdown zamiast <select>. Natywna lista opcji jest rysowana przez system
 * (na macOS ciemne menu) i CSS jej nie dosięga - stąd own component, żeby filtry
 * wyglądały jak reszta panelu. Wartość jedzie w ukrytym inpucie, więc formularz
 * GET działa dokładnie tak samo jak wcześniej.
 */

export type Option = { value: string; label: string };

export default function Dropdown({
  name,
  value,
  placeholder,
  options,
}: {
  name: string;
  value?: string;
  placeholder: string;
  options: Option[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(value ?? "");
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

  return (
    <div ref={box} className="relative">
      <input type="hidden" name={name} value={selected} />
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
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
        <ul
          role="listbox"
          className="absolute left-0 z-30 mt-1 max-h-72 min-w-full overflow-y-auto border-2 border-gold bg-white py-1 shadow-lg"
        >
          {[{ value: "", label: placeholder }, ...options].map((o) => {
            const active = o.value === selected;
            return (
              <li key={o.value || "__all"} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => { setSelected(o.value); setOpen(false); }}
                  className={`block w-full whitespace-nowrap px-3 py-1.5 text-left text-sm transition ${
                    active ? "bg-plum text-cream" : "text-ink hover:bg-sand"
                  }`}
                >
                  {o.label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
