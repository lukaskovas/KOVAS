"use client";

import { useActionState, useState } from "react";
import { resetPassword } from "./actions";

/** Awaryjna zmiana hasła przez admina - gdy ktoś zapomni hasła (nie ma resetu mailem). */
export default function ResetPasswordForm({ id, email }: { id: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [result, formAction] = useActionState(resetPassword, null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs uppercase tracking-wider text-plum underline"
      >
        Ustaw nowe
      </button>
    );
  }

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input
        type="text"
        name="password"
        required
        minLength={8}
        placeholder={`nowe hasło dla ${email}`}
        className="w-56 border-2 border-gold bg-cream px-2 py-1 text-sm outline-none focus:border-plum"
      />
      <button type="submit" className="text-xs uppercase tracking-wider text-plum underline">
        Zapisz
      </button>
      {result && (
        <span className="text-xs text-plum-light">{result === "OK" ? "zmienione" : result}</span>
      )}
    </form>
  );
}
