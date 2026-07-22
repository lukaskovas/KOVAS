"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateContractor } from "../actions";
import ContractorFields, { type ContractorValues } from "../contractor-fields";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="font-display bg-plum px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-cream transition hover:bg-plum-light disabled:opacity-60"
    >
      {pending ? "Zapisywanie..." : "Zapisz zmiany"}
    </button>
  );
}

export default function EditContractorForm({
  id,
  values,
  agents,
  ctypes,
}: {
  id: string;
  values: ContractorValues;
  agents: string[];
  ctypes: string[];
}) {
  const [result, formAction] = useActionState(updateContractor, null);
  const ok = result === "OK";

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={id} />
      <ContractorFields values={values} agents={agents} ctypes={ctypes} />

      {result && (
        <p className="border-l-4 border-plum bg-sand px-3 py-2 text-sm text-plum">
          {ok ? "Zapisano zmiany." : result}
        </p>
      )}

      <SubmitButton />
    </form>
  );
}
