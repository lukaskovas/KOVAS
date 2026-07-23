"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { refreshReports } from "@/lib/sync/refresh-reports";

const PATH = "/admin/kontrahenci";

/** Pola edytowalne kontrahenta. Puste tekstowe -> null, żeby nie zapisywać pustych stringów. */
function parseFields(fd: FormData) {
  const text = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? null : v;
  };
  const num = (k: string) => {
    const v = String(fd.get(k) ?? "").trim().replace(",", ".");
    if (v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const agent = text("agent");
  return {
    name: text("name"),
    vat_number: text("vat_number"),
    email: text("email"),
    phone_number: text("phone_number"),
    address: text("address"),
    zip_code: text("zip_code"),
    city: text("city"),
    country: text("country"),
    country_iso_code: text("country_iso_code"),
    contractor_type: text("contractor_type"),
    agent,
    // Admin ustawił opiekuna ręcznie - nadpisuje źródło auto-dopasowania z EASI (nip/name).
    agent_source: agent ? "manual" : null,
    discount: num("discount"),
    credit_limit: num("credit_limit"),
  };
}

/** Odświeżenie migawki raportowej po zmianie name/agent/contractor_type - błąd nie może
 *  wywrócić zapisu, bo dane w companies są już zapisane; raporty dogonią przy następnym syncu. */
async function refreshQuiet() {
  try {
    await refreshReports();
  } catch (e) {
    console.error("refresh_reports po edycji kontrahenta:", e);
  }
}

export async function createContractor(_prev: string | null, formData: FormData): Promise<string | null> {
  await requireAdmin();

  const fields = parseFields(formData);
  if (!fields.name) return "Podaj nazwę kontrahenta.";

  // id pomijamy - default sekwencji companies_manual_id_seq nada ujemny (migracja 0019).
  const { error } = await supabaseAdmin()
    .from("companies")
    .insert({ ...fields, raw: { source: "manual" } });
  if (error) return `Nie udało się dodać kontrahenta: ${error.message}`;

  await refreshQuiet();
  revalidatePath(PATH);
  revalidatePath("/");
  return "OK";
}

export async function updateContractor(_prev: string | null, formData: FormData): Promise<string | null> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return "Brak identyfikatora kontrahenta.";

  const fields = parseFields(formData);
  if (!fields.name) return "Podaj nazwę kontrahenta.";

  const { error } = await supabaseAdmin().from("companies").update(fields).eq("id", id);
  if (error) return `Nie udało się zapisać zmian: ${error.message}`;

  await refreshQuiet();
  revalidatePath(PATH);
  revalidatePath(`${PATH}/${id}`);
  revalidatePath("/");
  return "OK";
}
