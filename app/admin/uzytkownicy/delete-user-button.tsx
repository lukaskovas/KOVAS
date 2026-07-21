"use client";

import { deleteUser } from "./actions";

export default function DeleteUserButton({ id, email }: { id: string; email: string }) {
  return (
    <form
      action={deleteUser}
      onSubmit={(e) => {
        if (!confirm(`Usunąć konto ${email}? Tej operacji nie da się cofnąć.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button type="submit" className="text-xs uppercase tracking-wider text-plum underline">
        Usuń
      </button>
    </form>
  );
}
