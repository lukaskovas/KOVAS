import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";
import { sortableKeys, type ReportView } from "@/lib/report-columns";

/**
 * Odczyt raportów z Supabase (nie live z Turis) - zasila panel (app/view-data.tsx)
 * oraz eksport CSV (app/api/export/route.ts).
 *
 * Wyszukiwanie, filtry i sortowanie działają SERWEROWO - na całym zbiorze w bazie,
 * nie tylko na załadowanej stronie. To była główna słabość poprzedniej wersji:
 * sortowanie i eksport obejmowały wyłącznie bieżące 100 wierszy.
 */

const PAGE_SIZE = 100;
/**
 * Górna granica eksportu - bezpiecznik przed zrzutem bez końca, NIE cichy limit.
 * Największy zbiór to dziś 89515 pozycji zamówień, więc 250k daje realny zapas.
 * Gdy limit zostanie osiągnięty, eksport musi to jawnie zasygnalizować (patrz api/export)
 * - po cichu obcięty raport wygląda jak kompletny i to już raz kosztowało nas błąd.
 */
export const EXPORT_LIMIT = 250_000;

export type Paginated<T> = { data: T[]; total: number; page: number; lastPage: number };

/** Filtry wspólne dla raportów. Puste pola są pomijane. */
export type Filters = {
  q?: string;
  /** Zakres dat na kolumnie daty zamówienia (YYYY-MM-DD, granice włącznie). */
  from?: string;
  to?: string;
  status?: string;
  currency?: string;
  match?: string;
  country?: string;
  /** Handlowiec (opiekun kontrahenta) i typ kontrahenta - z kartoteki EASI, migracja 0011. */
  agent?: string;
  ctype?: string;
  /** Konkretny kontrahent po stabilnym company_id (migracja 0014) - dotyczy tylko zamówień. */
  company?: string;
  sort?: string;
  dir?: "asc" | "desc";
};

type ViewConfig = {
  view: string;
  dateColumn?: string;
  searchColumns: string[];
  defaultSort: string;
  defaultDir: "asc" | "desc";
  /** Kolumny, na których wolno filtrować - klucz filtru -> kolumna w widoku. */
  filterColumns: Partial<Record<"status" | "currency" | "match" | "country" | "agent" | "ctype" | "company", string>>;
};

const CONFIG: Record<ReportView, ViewConfig> = {
  orders: {
    // Migawka, nie v_orders_report - powód i konsekwencje w migracji 0010_mv_full_columns.sql.
    // Ma komplet kolumn widoku, więc tabela i eksport CSV pokazują dokładnie to samo co wcześniej.
    view: "mv_report_orders",
    dateColumn: "turis_created_at",
    searchColumns: ["display_order_number", "company_name", "invoice_fullnumber", "vat_number"],
    defaultSort: "turis_created_at",
    defaultDir: "desc",
    // sales_agent, nie agent: migawka wystawia oba - "agent" to martwe pole z Turis (puste
    // w 0/10478 zamówień), "sales_agent" to opiekun z kartoteki EASI. Patrz migracja 0011.
    filterColumns: {
      status: "current_status_name", currency: "currency_code", match: "invoice_match_status",
      agent: "sales_agent", ctype: "contractor_type", company: "company_id",
    },
  },
  products: {
    view: "v_order_items_report",
    dateColumn: "turis_created_at",
    searchColumns: ["display_order_number", "company_name", "product_name", "sku", "ean"],
    defaultSort: "turis_created_at",
    defaultDir: "desc",
    filterColumns: { currency: "currency_code" },
  },
  companies: {
    view: "companies",
    searchColumns: ["name", "vat_number", "city", "email"],
    defaultSort: "name",
    defaultDir: "asc",
    filterColumns: { country: "country", agent: "agent", ctype: "contractor_type" },
  },
};

/** Buduje zapytanie z samymi filtrami (bez sortowania) - wspólny rdzeń wszystkich ścieżek. */
function buildQuery(v: ReportView, f: Filters, select: string, count: boolean) {
  const cfg = CONFIG[v];
  let query = count
    ? supabaseAdmin().from(cfg.view).select(select, { count: "exact" })
    : supabaseAdmin().from(cfg.view).select(select);

  if (f.q?.trim()) {
    // znaki wieloznaczne PostgREST-a usuwamy, żeby wpisany '%' nie zmieniał sensu zapytania
    const needle = f.q.trim().replace(/[%_,()]/g, "");
    if (needle) query = query.or(cfg.searchColumns.map((c) => `${c}.ilike.%${needle}%`).join(","));
  }
  if (cfg.dateColumn && f.from) query = query.gte(cfg.dateColumn, f.from);
  // 'to' włącznie: data końcowa + 1 dzień, bo kolumna to timestamp, nie data
  if (cfg.dateColumn && f.to) {
    const next = new Date(f.to + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    query = query.lt(cfg.dateColumn, next.toISOString().slice(0, 10));
  }
  for (const key of ["status", "currency", "match", "country", "agent", "ctype", "company"] as const) {
    const col = cfg.filterColumns[key];
    const val = f[key];
    if (col && val) query = query.eq(col, val);
  }

  return query;
}

/** Zapytanie posortowane wg wyboru użytkownika - pod ekran (jedna strona naraz). */
function buildSortedQuery(v: ReportView, f: Filters, select: string, count: boolean) {
  const cfg = CONFIG[v];
  const allowed = sortableKeys(v);
  const sort = f.sort && allowed.includes(f.sort) ? f.sort : cfg.defaultSort;
  const dir = f.dir ?? (f.sort ? "asc" : cfg.defaultDir);
  // Tiebreaker po id: bez niego wiersze o tej samej wartości sortowania (np. wspólna data)
  // mogłyby wędrować między stronami przy przewijaniu.
  return buildQuery(v, f, select, count)
    .order(sort, { ascending: dir === "asc" })
    .order("id", { ascending: true });
}

export async function getReport<T>(v: ReportView, page: number, f: Filters): Promise<Paginated<T>> {
  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await buildSortedQuery(v, f, "*", true).range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(`select ${CONFIG[v].view}: ${error.message}`);
  const total = count ?? 0;
  return { data: (data ?? []) as T[], total, page, lastPage: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/**
 * CAŁY wynik po filtrach, porcjami po 1000 (Supabase twardo ogranicza pojedynczą odpowiedź
 * PostgREST - patrz lib/supabase.ts).
 *
 * Paginacja KLUCZOWA (seek po id), nie po OFFSET. Powód praktyczny: przy 89515 pozycjach
 * `range(80000, 80999)` na widoku z JOIN-ami kończyło się `statement timeout` - Postgres musi
 * policzyć i przeskoczyć wszystkie wcześniejsze wiersze. `id > ostatnie_id` idzie po indeksie
 * i ma stały koszt niezależnie od tego, jak głęboko jesteśmy.
 *
 * Konsekwencja: wynik jest w kolejności id, a NIE w sortowaniu wybranym na ekranie.
 * Dla eksportu to bez znaczenia (filtry decydują o zawartości, kolejność ustawia się w Excelu),
 * a dla sum kolejność jest nieistotna.
 */
const CHUNK = 1000;

export async function* iterateReport<T extends { id: number }>(v: ReportView, f: Filters): AsyncGenerator<T[]> {
  let lastId = -1;
  let fetched = 0;
  for (;;) {
    const { data, error } = await buildQuery(v, f, "*", false)
      .gt("id", lastId)
      .order("id", { ascending: true })
      .limit(CHUNK);
    if (error) throw new Error(`export ${CONFIG[v].view}: ${error.message}`);
    const rows = (data ?? []) as unknown as T[];
    if (!rows.length) return;
    yield rows;
    fetched += rows.length;
    if (rows.length < CHUNK || fetched >= EXPORT_LIMIT) return;
    lastId = Number(rows[rows.length - 1].id);
  }
}

export async function getReportAll<T extends { id: number }>(v: ReportView, f: Filters): Promise<T[]> {
  const all: T[] = [];
  for await (const chunk of iterateReport<T>(v, f)) all.push(...chunk);
  return all;
}

/**
 * Sumy dla AKTUALNEGO filtra - liczone na całym wyniku, nie na bieżącej stronie.
 * Kwoty sumujemy w PLN (net_pln/gross_pln, przeliczone kursem NBP z dnia poprzedzającego
 * zamówienie) - inaczej dodawalibyśmy złotówki do euro. `missingRate` sygnalizuje zamówienia,
 * dla których nie było notowania i które wypadły z sumy.
 */
export type OrderTotals = { count: number; net: number; gross: number; cogs: number; margin: number; missingRate: number };

export async function getOrderTotals(f: Filters): Promise<OrderTotals> {
  type Row = { id: number; net_pln: number | null; gross_pln: number | null; cogs_total: number | null; margin: number | null };
  const rows = await getReportAll<Row>("orders", f);
  const sum = (pick: (r: Row) => number | null) => rows.reduce((a, r) => a + (Number(pick(r)) || 0), 0);
  return {
    count: rows.length,
    net: sum((r) => r.net_pln),
    gross: sum((r) => r.gross_pln),
    cogs: sum((r) => r.cogs_total),
    margin: sum((r) => r.margin),
    missingRate: rows.filter((r) => r.net_pln === null).length,
  };
}

/** Wartości do list rozwijanych w filtrach - czytane z danych, nie zaszyte na sztywno. */
export type FilterOptions = {
  statuses: string[]; currencies: string[]; matches: string[]; countries: string[];
  agents: string[]; ctypes: string[];
};

/**
 * Cache: te listy przelicza UNION po całych tabelach orders+companies, a zmieniają się tylko
 * przy synchronizacji (nowy status, nowy kraj) - czyli praktycznie nigdy w trakcie przeglądania.
 * Bez cache szło to od nowa przy KAŻDYM kliknięciu strony, filtra i sortowania.
 * 5 minut, bo sync jest ręczny - nowa wartość filtra pojawi się najpóźniej chwilę po nim.
 */
export const getFilterOptions = unstable_cache(fetchFilterOptions, ["filter-options"], {
  revalidate: 300,
});

async function fetchFilterOptions(): Promise<FilterOptions> {
  const db = supabaseAdmin();
  // Distinct liczy widok v_filter_options po całych tabelach. Wcześniej robiliśmy to w JS
  // z próbki `limit 5000` - przy 10k+ zamówień rzadkie statusy (Pending, Awaiting Fulfillment)
  // nigdy nie trafiały do próbki i nie dało się po nich filtrować.
  const { data } = await db.from("v_filter_options").select("kind,value");
  const rows = (data ?? []) as { kind: string; value: string }[];
  const of = (kind: string) =>
    rows.filter((r) => r.kind === kind).map((r) => r.value).sort((a, b) => a.localeCompare(b, "pl"));
  return {
    statuses: of("status"),
    currencies: of("currency"),
    matches: of("match"),
    countries: of("country"),
    agents: of("agent"),
    ctypes: of("ctype"),
  };
}

/** Kontrahent do wyszukiwarki filtra zamówień - id (stabilny klucz) + nazwa do pokazania. */
export type ContractorOption = { id: number; name: string };

/**
 * Lista kontrahentów mających zamówienia (widok v_order_contractors, migracja 0014).
 * Cache jak filtry - zmienia się tylko przy synchronizacji. Zbiór to ~1,3 tys. firm,
 * więc mieści się w jednej odpowiedzi PostgREST (limit 1000... - stąd jawny range do 5000
 * na wypadek wzrostu; gdyby kiedyś przekroczył, trzeba dobierać porcjami jak w iterateReport).
 */
export const getContractorOptions = unstable_cache(fetchContractorOptions, ["contractor-options"], {
  revalidate: 300,
});

async function fetchContractorOptions(): Promise<ContractorOption[]> {
  const { data, error } = await supabaseAdmin()
    .from("v_order_contractors")
    .select("id,name")
    .order("name", { ascending: true })
    .range(0, 4999);
  if (error) throw new Error(`select v_order_contractors: ${error.message}`);
  return (data ?? []) as ContractorOption[];
}

export type SyncHealthRow = {
  source: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  records_upserted: number | null;
  records_failed: number | null;
  error_message: string | null;
};

export async function getSyncHealth(): Promise<SyncHealthRow[]> {
  const { data, error } = await supabaseAdmin().from("v_sync_health").select("*");
  if (error) throw new Error(`select v_sync_health: ${error.message}`);
  return (data ?? []) as SyncHealthRow[];
}
