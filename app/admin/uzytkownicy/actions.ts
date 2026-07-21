"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";

const PATH = "/admin/uzytkownicy";

export async function createUser(_prev: string | null, formData: FormData): Promise<string | null> {
  await requireAdmin();

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "user") === "admin" ? "admin" : "user";

  if (!email) return "Podaj email.";
  if (password.length < 8) return "Hasło musi mieć co najmniej 8 znaków.";

  const db = supabaseAdmin();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // konto zakłada admin, więc nie wysyłamy maila potwierdzającego
  });
  if (error || !data.user) return `Nie udało się utworzyć konta: ${error?.message ?? "nieznany błąd"}`;

  const { error: profileError } = await db.from("profiles").insert({ id: data.user.id, email, role });
  if (profileError) {
    // Bez wiersza w profiles konto i tak nie wpuści do panelu - sprzątamy, żeby nie zostawiać sieroty
    await db.auth.admin.deleteUser(data.user.id);
    return `Nie udało się zapisać uprawnień: ${profileError.message}`;
  }

  revalidatePath(PATH);
  return "OK";
}

export async function setRole(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const role = String(formData.get("role") ?? "user") === "admin" ? "admin" : "user";

  // Odebranie sobie uprawnień mogłoby zostawić panel bez żadnego admina
  if (id === admin.id) return;

  await supabaseAdmin().from("profiles").update({ role }).eq("id", id);
  revalidatePath(PATH);
}

export async function deleteUser(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (id === admin.id) return;

  const db = supabaseAdmin();
  // Kasujemy konto w Auth - profiles ma "on delete cascade", więc wiersz zniknie razem z nim
  await db.auth.admin.deleteUser(id);
  revalidatePath(PATH);
}

export async function resetPassword(_prev: string | null, formData: FormData): Promise<string | null> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return "Hasło musi mieć co najmniej 8 znaków.";

  const { error } = await supabaseAdmin().auth.admin.updateUserById(id, { password });
  if (error) return `Nie udało się zmienić hasła: ${error.message}`;

  revalidatePath(PATH);
  return "OK";
}
