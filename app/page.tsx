import { Suspense } from "react";
import ViewData, { TableSkeleton, type View } from "./view-data";
import Shell from "./shell";
import { type Filters } from "@/lib/queries";
import { requireUser } from "@/lib/auth";

// Zimne zapytania raportowe (report_kpi po ~89 tys. pozycji) potrafią zająć ~12 s po chwili
// bezczynności bazy. Bez tego strona łapie domyślny limit funkcji Vercela (10 s) i jest ubijana
// w trakcie streamowania KPI - stąd czarny ekran "server error" przy przełączaniu zakładek.
export const maxDuration = 60;

type SearchParams = {
  view?: string; page?: string; q?: string; from?: string; to?: string;
  status?: string; currency?: string; match?: string; realization?: string; country?: string;
  agent?: string; ctype?: string; company?: string; sort?: string; dir?: string;
};

export default async function Home({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const view: View = (["orders", "products", "companies"].includes(sp.view ?? "") ? sp.view : "orders") as View;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const clean = (v?: string) => v?.trim() || undefined;
  const dir: "asc" | "desc" | undefined = sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : undefined;
  const filters: Filters = {
    q: clean(sp.q),
    from: clean(sp.from),
    to: clean(sp.to),
    status: clean(sp.status),
    currency: clean(sp.currency),
    match: clean(sp.match),
    realization: clean(sp.realization),
    country: clean(sp.country),
    agent: clean(sp.agent),
    ctype: clean(sp.ctype),
    company: clean(sp.company),
    sort: clean(sp.sort),
    dir,
  };
  // params trafiają do linków sortujących, paginacji i eksportu - dzięki temu
  // zmiana sortowania czy strony nie gubi ustawionych filtrów
  const params: Record<string, string | undefined> = { ...filters, view };

  return (
    <Shell active={view} user={user}>
      {/* Dane - streamowane, żeby przełączanie było natychmiastowe */}
      <Suspense key={JSON.stringify({ view, page, filters })} fallback={<TableSkeleton />}>
        <ViewData view={view} page={page} filters={filters} params={params} isAdmin={user.role === "admin"} />
      </Suspense>
    </Shell>
  );
}
