import Shell from "../shell";
import { requireUser } from "@/lib/auth";
import PasswordForm from "./password-form";

export const metadata = { title: "Kovas · Moje konto" };

export default async function KontoPage() {
  const user = await requireUser();

  return (
    <Shell active={null} user={user}>
      <h1 className="font-display mb-1 text-lg font-bold uppercase tracking-wider text-plum">Moje konto</h1>
      <p className="mb-6 text-sm text-plum-light">
        {user.email} · {user.role === "admin" ? "administrator" : "użytkownik"}
      </p>

      <PasswordForm />
    </Shell>
  );
}
