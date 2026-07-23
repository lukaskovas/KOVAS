import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "../../../shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getFilterOptions } from "@/lib/queries";
import EditContractorForm from "./edit-contractor-form";
import type { ContractorValues } from "../contractor-fields";

export const metadata = { title: "Kovas · Edycja kontrahenta" };

export default async function EditContractorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdmin();
  const { id } = await params;

  const [contractor, options] = await Promise.all([
    supabaseAdmin()
      .from("companies")
      .select(
        "id, name, vat_number, email, phone_number, address, zip_code, city, country, country_iso_code, contractor_type, agent, discount, credit_limit",
      )
      .eq("id", id)
      .maybeSingle(),
    getFilterOptions(),
  ]);

  const data = contractor.data as (ContractorValues & { id: number }) | null;
  if (!data) notFound();

  return (
    <Shell active={null} user={admin}>
      <div className="mb-6 flex flex-wrap items-baseline gap-3">
        <Link href="/?view=companies" className="text-xs uppercase tracking-wider text-plum underline">
          ← Kontrahenci
        </Link>
        <h1 className="font-display text-lg font-bold uppercase tracking-wider text-plum">
          {data.name || "Edycja kontrahenta"}
        </h1>
        <span className="font-mono text-xs text-plum-light">ID {data.id}</span>
      </div>

      <div className="border-2 border-gold bg-white p-5">
        <EditContractorForm
          id={String(data.id)}
          values={data}
          agents={options.agents}
          ctypes={options.ctypes}
        />
      </div>
    </Shell>
  );
}
