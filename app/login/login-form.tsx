"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signIn } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="font-display w-full bg-plum px-5 py-3 text-xs font-semibold uppercase tracking-wider text-cream transition hover:bg-plum-light disabled:opacity-60"
    >
      {pending ? "Logowanie..." : "Zaloguj się"}
    </button>
  );
}

export default function LoginForm({ next }: { next?: string }) {
  const [error, formAction] = useActionState(signIn, null);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />

      <label className="block">
        <span className="font-display text-xs font-semibold uppercase tracking-wider text-plum">Email</span>
        <input
          type="email"
          name="email"
          required
          autoComplete="username"
          autoFocus
          className="mt-1 w-full border-2 border-gold bg-cream px-3 py-2 text-sm outline-none focus:border-plum"
        />
      </label>

      <label className="block">
        <span className="font-display text-xs font-semibold uppercase tracking-wider text-plum">Hasło</span>
        <input
          type="password"
          name="password"
          required
          autoComplete="current-password"
          className="mt-1 w-full border-2 border-gold bg-cream px-3 py-2 text-sm outline-none focus:border-plum"
        />
      </label>

      {error && <p className="border-l-4 border-plum bg-sand px-3 py-2 text-sm text-plum">{error}</p>}

      <SubmitButton />
    </form>
  );
}
