"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { createContractor } from "./actions";
import ContractorFields from "./contractor-fields";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="font-display bg-plum px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-cream transition hover:bg-plum-light disabled:opacity-60"
    >
      {pending ? "Dodawanie..." : "Dodaj kontrahenta"}
    </button>
  );
}

export default function NewContractorForm({ agents, ctypes }: { agents: string[]; ctypes: string[] }) {
  const [result, formAction] = useActionState(createContractor, null);
  const formRef = useRef<HTMLFormElement>(null);
  const ok = result === "OK";

  useEffect(() => {
    if (ok) formRef.current?.reset();
  }, [ok]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <ContractorFields agents={agents} ctypes={ctypes} />

      {result && (
        <p className="border-l-4 border-plum bg-sand px-3 py-2 text-sm text-plum">
          {ok ? "Kontrahent dodany." : result}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
