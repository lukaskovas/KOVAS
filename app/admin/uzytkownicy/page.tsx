import Shell from "../../shell";
import Dropdown from "../../dropdown";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { setRole } from "./actions";
import DeleteUserButton from "./delete-user-button";
import NewUserForm from "./new-user-form";
import ResetPasswordForm from "./reset-password-form";

export const metadata = { title: "Kovas · Użytkownicy" };

type Row = { id: string; email: string; role: "admin" | "user"; created_at: string };

export default async function UsersPage() {
  const admin = await requireAdmin();

  const { data } = await supabaseAdmin()
    .from("profiles")
    .select("id, email, role, created_at")
    .order("created_at", { ascending: true });
  const users = (data ?? []) as Row[];

  return (
    <Shell active={null} user={admin}>
      <h1 className="font-display mb-6 text-lg font-bold uppercase tracking-wider text-plum">Użytkownicy</h1>

      <div className="mb-8 border-2 border-gold bg-white p-5">
        <h2 className="font-display mb-4 text-xs font-semibold uppercase tracking-wider text-plum">
          Dodaj konto
        </h2>
        <NewUserForm />
      </div>

      <div className="overflow-x-auto border-2 border-gold bg-white">
        <table className="w-full text-sm">
          <thead className="bg-sand">
            <tr className="font-display text-left text-xs uppercase tracking-wider text-plum">
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Rola</th>
              <th className="px-4 py-3">Utworzone</th>
              <th className="px-4 py-3">Hasło</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === admin.id;
              return (
                <tr key={u.id} className="border-t border-gold/50 align-middle">
                  <td className="px-4 py-3">
                    {u.email}
                    {isSelf && <span className="ml-2 text-xs text-plum-light">(to Ty)</span>}
                  </td>
                  <td className="px-4 py-3">
                    {isSelf ? (
                      <span className="text-plum-light">administrator</span>
                    ) : (
                      <form action={setRole} className="flex items-center gap-2">
                        <input type="hidden" name="id" value={u.id} />
                        <Dropdown
                          name="role"
                          value={u.role}
                          placeholder="Rola"
                          options={[
                            { value: "user", label: "użytkownik" },
                            { value: "admin", label: "administrator" },
                          ]}
                          includeEmpty={false}
                        />
                        <button type="submit" className="text-xs uppercase tracking-wider text-plum underline">
                          Zapisz
                        </button>
                      </form>
                    )}
                  </td>
                  <td className="px-4 py-3 text-plum-light">
                    {new Date(u.created_at).toLocaleDateString("pl-PL")}
                  </td>
                  <td className="px-4 py-3">
                    <ResetPasswordForm id={u.id} email={u.email} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!isSelf && <DeleteUserButton id={u.id} email={u.email} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
