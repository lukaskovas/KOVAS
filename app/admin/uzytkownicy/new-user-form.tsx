"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { createUser } from "./actions";
import Dropdown from "../../dropdown";

const ROLE_OPTIONS = [
  { value: "user", label: "użytkownik" },
  { value: "admin", label: "administrator" },
];

const inputClass = "mt-1 w-full border-2 border-gold bg-cream px-3 py-2 text-sm outline-none focus:border-plum";
const labelClass = "font-display text-xs font-semibold uppercase tracking-wider text-plum";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="font-display bg-plum px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-cream transition hover:bg-plum-light disabled:opacity-60"
    >
      {pending ? "Tworzenie..." : "Dodaj konto"}
    </button>
  );
}

export default function NewUserForm() {
  const [result, formAction] = useActionState(createUser, null);
  const formRef = useRef<HTMLFormElement>(null);
  const ok = result === "OK";

  useEffect(() => {
    if (ok) formRef.current?.reset();
  }, [ok]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={labelClass}>Email</span>
          <input type="email" name="email" required className={inputClass} />
        </label>

        <label className="block">
          <span className={labelClass}>Hasło startowe</span>
          <input type="text" name="password" required minLength={8} className={inputClass} />
        </label>

        <label className="block">
          <span className={labelClass}>Rola</span>
          <div className="mt-1">
            <Dropdown
              name="role"
              value="user"
              placeholder="Rola"
              options={ROLE_OPTIONS}
              includeEmpty={false}
              fullWidth
            />
          </div>
        </label>
      </div>

      <p className="text-xs text-plum-light">
        Hasło startowe przekaż użytkownikowi bezpiecznym kanałem - zmieni je sobie w zakładce Moje konto.
      </p>

      {result && (
        <p className="border-l-4 border-plum bg-sand px-3 py-2 text-sm text-plum">
          {ok ? "Konto utworzone." : result}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
