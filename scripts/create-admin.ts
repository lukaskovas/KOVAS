/**
 * Zakłada pierwsze konto administratora - jedyne, którego nie da się dodać przez panel
 * (żeby wejść do /admin/uzytkownicy, trzeba już być zalogowanym adminem).
 *
 * Użycie: npm run create-admin -- email@firma.pl "haslo-min-8-znakow"
 * Kolejne konta zakłada się już z poziomu panelu.
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    throw new Error('Użycie: npm run create-admin -- email@firma.pl "haslo"');
  }
  if (password.length < 8) throw new Error("Hasło musi mieć co najmniej 8 znaków.");

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Brak SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY w .env.local");

  const db = createClient<any>(url, key, { auth: { persistSession: false } });

  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`Nie udało się utworzyć konta: ${error?.message}`);

  const { error: profileError } = await db
    .from("profiles")
    .insert({ id: data.user.id, email, role: "admin" });
  if (profileError) {
    await db.auth.admin.deleteUser(data.user.id);
    throw new Error(`Nie udało się zapisać uprawnień: ${profileError.message}`);
  }

  console.log(`Administrator ${email} utworzony. Zaloguj się na /login.`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
