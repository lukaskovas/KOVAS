"use server";

import { requireUser, supabaseSession } from "@/lib/auth";

export async function changePassword(_prev: string | null, formData: FormData): Promise<string | null> {
  const user = await requireUser();
  const current = String(formData.get("current") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (password.length < 8) return "Nowe hasło musi mieć co najmniej 8 znaków.";
  if (password !== confirm) return "Nowe hasła nie są identyczne.";

  const supabase = await supabaseSession();

  // Supabase nie wymaga starego hasła przy updateUser - sprawdzamy je sami, żeby przejęta
  // (np. niezablokowana) sesja nie wystarczyła do przejęcia konta na stałe
  const { error: checkError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: current,
  });
  if (checkError) return "Obecne hasło jest nieprawidłowe.";

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return `Nie udało się zmienić hasła: ${error.message}`;

  return "OK";
}
