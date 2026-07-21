"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changePassword } from "./actions";

const inputClass = "mt-1 w-full border-2 border-gold bg-cream px-3 py-2 text-sm outline-none focus:border-plum";
const labelClass = "font-display text-xs font-semibold uppercase tracking-wider text-plum";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="font-display bg-plum px-5 py-3 text-xs font-semibold uppercase tracking-wider text-cream transition hover:bg-plum-light disabled:opacity-60"
    >
      {pending ? "Zapisywanie..." : "Zmień hasło"}
    </button>
  );
}

export default function PasswordForm() {
  const [result, formAction] = useActionState(changePassword, null);
  const ok = result === "OK";

  return (
    <form action={formAction} className="max-w-sm space-y-4">
      <label className="block">
        <span className={labelClass}>Obecne hasło</span>
        <input type="password" name="current" required autoComplete="current-password" className={inputClass} />
      </label>

      <label className="block">
        <span className={labelClass}>Nowe hasło</span>
        <input type="password" name="password" required autoComplete="new-password" minLength={8} className={inputClass} />
      </label>

      <label className="block">
        <span className={labelClass}>Powtórz nowe hasło</span>
        <input type="password" name="confirm" required autoComplete="new-password" minLength={8} className={inputClass} />
      </label>

      {result && (
        <p className={`border-l-4 px-3 py-2 text-sm ${ok ? "border-plum-light bg-sand text-plum" : "border-plum bg-sand text-plum"}`}>
          {ok ? "Hasło zmienione." : result}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
