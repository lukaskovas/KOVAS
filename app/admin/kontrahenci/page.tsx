import Link from "next/link";
import Shell from "../../shell";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { getFilterOptions } from "@/lib/queries";
import NewContractorForm from "./new-contractor-form";

export const metadata = { title: "Kovas · Kontrahenci (edycja)" };

type Row = {
  id: number;
  name: string | null;
  vat_number: string | null;
  city: string | null;
  agent: string | null;
  contractor_type: string | null;
};

/** Kontrahentów jest ~1,3 tys. - nie ładujemy wszystkich do tabeli, tylko dopasowania wyszukiwania. */
const LIMIT = 50;

export default async function ContractorsAdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const admin = await requireAdmin();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();

  const options = await getFilterOptions();

  let query = supabaseAdmin()
    .from("companies")
    .select("id, name, vat_number, city, agent, contractor_type")
    .order("name", { ascending: true })
    .limit(LIMIT);
  if (q) {
    // znaki wieloznaczne PostgREST-a usuwamy, tak jak w lib/queries.ts
    const needle = q.replace(/[%_,()]/g, "");
    if (needle) {
      query = query.or(
        `name.ilike.%${needle}%,vat_number.ilike.%${needle}%,city.ilike.%${needle}%,email.ilike.%${needle}%`,
      );
    }
  }
  const { data } = await query;
  const rows = (data ?? []) as Row[];

  return (
    <Shell active={null} user={admin}>
      <h1 className="font-display mb-6 text-lg font-bold uppercase tracking-wider text-plum">Kontrahenci</h1>

      <div className="mb-8 border-2 border-gold bg-white p-5">
        <h2 className="font-display mb-4 text-xs font-semibold uppercase tracking-wider text-plum">
          Dodaj kontrahenta
        </h2>
        <NewContractorForm agents={options.agents} ctypes={options.ctypes} />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Szukaj po nazwie, NIP, mieście, e-mailu..."
          className="w-full max-w-md border-2 border-gold bg-cream px-3 py-2 text-sm outline-none focus:border-plum"
        />
        <button
          type="submit"
          className="font-display bg-plum px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-cream transition hover:bg-plum-light"
        >
          Szukaj
        </button>
        {q && (
          <Link href="/admin/kontrahenci" className="text-xs uppercase tracking-wider text-plum underline">
            Wyczyść
          </Link>
        )}
      </form>

      <div className="overflow-x-auto border-2 border-gold bg-white">
        <table className="w-full text-sm">
          <thead className="bg-sand">
            <tr className="font-display text-left text-xs uppercase tracking-wider text-plum">
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Nazwa</th>
              <th className="px-4 py-3">NIP</th>
              <th className="px-4 py-3">Miasto</th>
              <th className="px-4 py-3">Handlowiec</th>
              <th className="px-4 py-3">Typ</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-gold/50 align-middle">
                <td className="px-4 py-3 font-mono text-xs text-plum-light">{r.id}</td>
                <td className="px-4 py-3 font-semibold">{r.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.vat_number}</td>
                <td className="px-4 py-3">{r.city}</td>
                <td className="px-4 py-3">{r.agent}</td>
                <td className="px-4 py-3">{r.contractor_type}</td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/admin/kontrahenci/${r.id}`}
                    className="text-xs uppercase tracking-wider text-plum underline"
                  >
                    Edytuj
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-plum-light">
                  {q ? "Brak kontrahentów dla tego zapytania." : "Brak kontrahentów."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {rows.length === LIMIT && (
        <p className="mt-3 text-xs text-plum-light">
          Pokazano pierwszych {LIMIT} - zawęź wyszukiwanie, żeby znaleźć konkretnego kontrahenta.
        </p>
      )}
    </Shell>
  );
}
