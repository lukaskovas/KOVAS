"use server";

import { redirect } from "next/navigation";
import { supabaseSession } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

export async function signIn(_prev: string | null, formData: FormData): Promise<string | null> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "") || "/";

  if (!email || !password) return "Podaj email i hasło.";

  const supabase = await supabaseSession();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return "Nieprawidłowy email lub hasło.";

  // Konto w Supabase Auth to za mało - dostęp ma tylko ktoś dopisany do profiles przez admina
  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("id")
    .eq("id", data.user.id)
    .maybeSingle();

  if (!profile) {
    await supabase.auth.signOut();
    return "To konto nie ma dostępu do panelu.";
  }

  // Otwarte przekierowanie: przyjmujemy tylko ścieżki wewnętrzne, nie pełne URL-e
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function signOut() {
  const supabase = await supabaseSession();
  await supabase.auth.signOut();
  redirect("/login");
}
