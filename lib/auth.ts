import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import { supabaseAdmin } from "./supabase";

/**
 * Logowanie panelu. Sesje i hasła obsługuje Supabase Auth (klucz anon, sesja w ciasteczkach),
 * a uprawnienia czytamy z tabeli profiles kluczem service_role.
 *
 * Zasada dostępu: sesja Supabase to za mało - użytkownik musi mieć wiersz w profiles.
 * Konta zakłada wyłącznie admin w /admin/uzytkownicy, nie ma samodzielnej rejestracji.
 */

export type CurrentUser = { id: string; email: string; role: "admin" | "user" };

/** Klient związany z sesją zalogowanego (ciasteczka) - do logowania, wylogowania, zmiany hasła. */
export async function supabaseSession() {
  // cookies() przed odczytem env celowo: to ono oznacza stronę jako dynamiczną, więc build
  // nie próbuje jej prerenderować (i nie wywraca się na braku zmiennych w czasie budowania)
  const store = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Brak NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY w środowisku");
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        // W Server Components zapis ciasteczek rzuca wyjątkiem - odświeżanie sesji robi
        // wtedy middleware, więc cicho pomijamy. W Server Actions zapis działa normalnie.
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {}
      },
    },
  });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await supabaseSession();
  // getUser(), nie getSession() - weryfikuje token u Supabase zamiast ufać ciasteczku
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("id, email, role")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile) return null;
  return { id: profile.id, email: profile.email, role: profile.role };
}

/** Do użycia na każdej chronionej stronie. Brak konta w profiles = wyrzuca na logowanie. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}
