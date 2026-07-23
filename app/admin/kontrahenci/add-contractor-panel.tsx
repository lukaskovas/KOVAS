"use client";

import { useState } from "react";
import NewContractorForm from "./new-contractor-form";

/**
 * Dodawanie kontrahenta wprost z zakładki Kontrahenci - rozwijany panel, żeby formularz
 * nie zajmował miejsca nad raportem, dopóki admin faktycznie nie chce dodać nowego.
 */
export default function AddContractorPanel({ agents, ctypes }: { agents: string[]; ctypes: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="font-display border-2 border-gold bg-white px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-plum transition hover:bg-sand"
      >
        {open ? "Zamknij" : "+ Dodaj kontrahenta"}
      </button>
      {open && (
        <div className="mt-3 border-2 border-gold bg-white p-5">
          <NewContractorForm agents={agents} ctypes={ctypes} />
        </div>
      )}
    </div>
  );
}
