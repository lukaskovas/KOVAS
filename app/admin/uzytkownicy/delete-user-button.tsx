"use client";

import { useEffect, useState } from "react";
import { deleteUser } from "./actions";

export default function DeleteUserButton({ id, email }: { id: string; email: string }) {
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!confirming) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setConfirming(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [confirming]);

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-xs uppercase tracking-wider text-plum underline"
      >
        Usuń
      </button>

      {confirming && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4"
          onMouseDown={() => setConfirming(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            onMouseDown={(e) => e.stopPropagation()}
            className="w-full max-w-md border-2 border-gold bg-cream text-center shadow-xl"
          >
            <div className="border-b border-gold px-5 py-4">
              <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-plum">
                Usunąć konto?
              </h2>
            </div>

            <div className="px-5 py-4">
              <p className="text-sm text-ink">
                Konto <span className="font-semibold text-plum">{email}</span> zostanie trwale usunięte.
                Tej operacji nie da się cofnąć.
              </p>
            </div>

            <div className="flex justify-center gap-3 border-t border-gold px-5 py-4">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="font-display border-2 border-gold px-5 py-2 text-xs font-semibold uppercase tracking-wider text-plum transition hover:border-plum"
              >
                Anuluj
              </button>
              <form action={deleteUser}>
                <input type="hidden" name="id" value={id} />
                <button
                  type="submit"
                  className="font-display bg-plum px-5 py-2 text-xs font-semibold uppercase tracking-wider text-cream transition hover:bg-plum-light"
                >
                  Usuń konto
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
