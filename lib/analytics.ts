import "server-only";
import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Raporty zbiorcze (zakładka "Raporty") - odczyt agregatów policzonych w bazie
 * (funkcje z migracji 0007_analytics.sql).
 *
 * Sumowanie NIE dzieje się tutaj: PostgREST oddaje maksymalnie 1000 wierszy, więc liczenie
 * w JS dawałoby wynik z próbki, a nie z całych 10 478 zamówień / 89 515 pozycji.
 * Aplikacja dostaje gotowe kilkadziesiąt wierszy raportu.
 *
 * Wszystkie kwoty są w PLN (kurs NBP z dnia poprzedzającego zamówienie - migracje 0005/0006).
 */

export type AnalyticsFilters = {
  from?: string;
  to?: string;
  currency?: string;
  status?: string;
  country?: string;
  match?: string;
  /** Handlowiec (opiekun kontrahenta) i typ kontrahenta - z kartoteki EASI, migracja 0011. */
  agent?: string;
  ctype?: string;
  /** Konkretny kontrahent po company_id - tylko KPI zamówień (migracja 0014). */
  company?: string;
  /** Typ dokumentu magazynowego dla raportu dostaw: "PZ" | "PW" | undefined (oba). */
  type?: string;
  q?: string;
  sort?: string;
  dir?: "asc" | "desc";
  limit?: number;
};

/** Wspólne parametry filtrów - każda funkcja raportowa przyjmuje ten sam zestaw. */
function filterArgs(f: AnalyticsFilters) {
  // Frazę czyścimy tak samo jak lib/queries.ts: w SQL trafia do `ilike '%' || p_q || '%'`,
  // więc wpisany '%' albo '_' zmieniłby sens zapytania i sumy przestałyby pasować do listy.
  const needle = f.q?.trim().replace(/[%_,()]/g, "") || null;
  return {
    p_from: f.from ?? null,
    p_to: f.to ?? null,
    p_currency: f.currency ?? null,
    p_status: f.status ?? null,
    p_country: f.country ?? null,
    p_q: needle,
    p_agent: f.agent ?? null,
    p_ctype: f.ctype ?? null,
  };
}

/**
 * Parametry dla report_kpi - jako jedyna funkcja raportowa zna p_match (migracja 0008),
 * bo tylko lista zamówień ma filtr "dopasowanie faktury". Pozostałe funkcje (report_orders_by,
 * report_products_by) tego parametru nie przyjmują i dosłanie go kończy się błędem
 * "Could not find the function ... in the schema cache" - stąd osobny zestaw, a nie
 * dopisanie p_match do filterArgs.
 *
 * p_company dochodzi tu z tego samego powodu: filtr kontrahenta obsługuje wyłącznie
 * report_kpi (migracja 0014), report_orders_by/report_products_by go nie przyjmują.
 */
function kpiArgs(f: AnalyticsFilters) {
  return { ...filterArgs(f), p_match: f.match ?? null, p_company: f.company ? Number(f.company) : null };
}

/**
 * PostgREST ucina odpowiedź na 1000 wierszy BEZ BŁĘDU - dotyczy też funkcji (rpc).
 * Eksport 1296 kontrahentów wracał przez to jako równe 1000 pozycji wyglądających na komplet.
 * Dlatego dobieramy wynik porcjami przez .range(), dopóki baza go oddaje.
 */
const RPC_PAGE = 1000;

async function rpc<T>(fn: string, args: Record<string, unknown>, want = RPC_PAGE): Promise<T[]> {
  const db = supabaseAdmin();
  const all: T[] = [];
  for (let offset = 0; offset < want; offset += RPC_PAGE) {
    const size = Math.min(RPC_PAGE, want - offset);
    const { data, error } = await db.rpc(fn, args).range(offset, offset + size - 1);
    if (error) throw new Error(`rpc ${fn}: ${error.message}`);
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < size) break;
  }
  return all;
}

export type Kpi = {
  orders_count: number;
  companies_count: number;
  skus_count: number;
  items_qty: number;
  net_pln: number;
  gross_pln: number;
  vat_pln: number;
  discount_pln: number;
  cogs_pln: number;
  margin_pln: number;
  avg_order_pln: number;
  avg_items_per_order: number;
  first_order: string | null;
  last_order: string | null;
  /** Zamówienia bez kursu NBP na swoją datę - wypadły z sum (migracja 0009). */
  missing_rate_count: number;
  /** Zamówienia bez policzonego kosztu (brak WZ z wFirmy) - nie obejmuje ich marża (migracja 0020). */
  missing_cost_count: number;
  /** Wiszące zamówienia (era wFirMY, bez faktury) - wypadły z przychodu/kosztu, liczone osobno (migracja 0028). */
  awaiting_orders_count: number;
  /** Łączna wartość netto wiszących zamówień (bez faktury) w PLN (migracja 0028). */
  awaiting_net_pln: number;
};

/** Czy filtr jest pusty - wtedy KPI == cała historia, którą mamy gotową w snapshocie. */
function hasNoFilters(f: AnalyticsFilters): boolean {
  return (
    !f.from && !f.to && !f.currency && !f.status && !f.country &&
    !f.match && !f.agent && !f.ctype && !f.company && !f.q?.trim()
  );
}

/** Kolumny snapshotu 1:1 z typem Kpi (migracja 0027). */
const KPI_SNAPSHOT_COLS =
  "orders_count,companies_count,skus_count,items_qty,net_pln,gross_pln,vat_pln,discount_pln," +
  "cogs_pln,margin_pln,avg_order_pln,avg_items_per_order,first_order,last_order," +
  "missing_rate_count,missing_cost_count,awaiting_orders_count,awaiting_net_pln";

/**
 * Gotowe KPI całej historii z tabeli-snapshotu (liczonej podczas synchronizacji, migracja 0027).
 * Odczyt jednego wiersza jest natychmiastowy nawet przy dławionym CPU bazy. Snapshot to
 * optymalizacja, nie źródło prawdy - brak wiersza / błąd zwraca null, a wołający liczy KPI na żywo.
 */
async function readKpiSnapshot(): Promise<Kpi | null> {
  const { data, error } = await supabaseAdmin()
    .from("report_kpi_snapshot")
    .select(KPI_SNAPSHOT_COLS)
    .eq("id", 1)
    .maybeSingle();
  if (error) return null;
  return (data as Kpi | null) ?? null;
}

async function fetchKpi(f: AnalyticsFilters): Promise<Kpi | null> {
  // Domyślny widok (cała historia) - bierzemy gotowy snapshot zamiast liczyć najcięższe
  // zapytanie na żywo. Gdy snapshotu jeszcze nie ma (pierwszy deploy przed pierwszym syncem),
  // spadamy do liczenia na żywo.
  if (hasNoFilters(f)) {
    const snap = await readKpiSnapshot();
    if (snap) return snap;
  }
  const rows = await rpc<Kpi>("report_kpi", kpiArgs(f));
  return rows[0] ?? null;
}

/**
 * Cache jak dla filtrów i kontrahentów (lib/queries.ts): report_kpi to najcięższe zapytanie,
 * a jego wynik zmienia się tylko przy synchronizacji (co 15 min), nie w trakcie przeglądania.
 * Instancja bazy jest burstowa (CPU bywa dławione: to samo zapytanie raz 0,5 s, raz 12 s+),
 * więc cache 5 min zdejmuje z niej powtórne przeliczenia - po pierwszym udanym policzeniu
 * kolejne wejścia (ten sam zestaw filtrów) idą z cache w milisekundach. Klucz cache to
 * zserializowane argumenty, więc różne filtry mają osobne wpisy.
 */
export const getKpi = unstable_cache(fetchKpi, ["order-kpi"], { revalidate: 300 });

/** Wiersz agregatu - wspólny kształt dla wszystkich wymiarów (część kolumn bywa pusta). */
export type AggRow = {
  label: string;
  sublabel: string | null;
  ean?: string | null;
  agent?: string | null;
  orders_count: number;
  companies_count?: number;
  items_qty?: number;
  net_pln: number;
  gross_pln?: number;
  vat_pln?: number;
  discount_pln?: number;
  cogs_pln?: number;
  margin_pln?: number;
  avg_order_pln?: number;
  avg_price_pln?: number;
  share_pct?: number | null;
  prev_net_pln?: number | null;
  change_pct?: number | null;
  first_order?: string | null;
  last_order?: string | null;
  first_sale?: string | null;
  last_sale?: string | null;
  days_since?: number;
};

export async function getOrdersBy(dim: string, f: AnalyticsFilters): Promise<AggRow[]> {
  const limit = f.limit ?? 100;
  return rpc<AggRow>(
    "report_orders_by",
    { p_dim: dim, ...filterArgs(f), p_sort: f.sort ?? null, p_dir: f.dir ?? null, p_limit: limit },
    limit,
  );
}

export async function getProducts(f: AnalyticsFilters): Promise<AggRow[]> {
  const limit = f.limit ?? 100;
  return rpc<AggRow>(
    "report_products_by",
    { ...filterArgs(f), p_sort: f.sort ?? null, p_dir: f.dir ?? null, p_limit: limit },
    limit,
  );
}

export async function getDormant(days: number, limit: number, agent?: string): Promise<AggRow[]> {
  return rpc<AggRow>("report_dormant_companies", { p_days: days, p_limit: limit, p_agent: agent ?? null }, limit);
}

/**
 * Zakupy per produkt - z dokumentów przyjęć magazynowych wFirma (migracja 0015).
 * Inne źródło niż reszta raportów (wfirma_receipt_layers, nie mv_report_orders), więc osobna
 * funkcja. Filtry ograniczone do zakresu dat przyjęcia i wyszukiwania - reszta filtrów
 * (waluta/status/handlowiec) dotyczy sprzedaży i tu nie ma sensu, funkcja SQL je ignoruje.
 */
export async function getPurchases(f: AnalyticsFilters): Promise<AggRow[]> {
  const limit = f.limit ?? 100;
  const needle = f.q?.trim().replace(/[%_,()]/g, "") || null;
  return rpc<AggRow>(
    "report_purchases_by_product",
    { p_from: f.from ?? null, p_to: f.to ?? null, p_q: needle, p_sort: f.sort ?? null, p_dir: f.dir ?? null, p_limit: limit },
    limit,
  );
}

// ============================================================
// Raport dostaw (migracja 0025) - ruchy magazynowe PZ/PW per dokument, z rozbiciem na pozycje.
// Inny kształt niż AggRow (nagłówek dostawy + zagnieżdżone pozycje), więc własne typy i funkcja.
// ============================================================

export type DeliveryItem = {
  sku: string | null;
  brand: string | null;
  name: string | null;
  ean: string | null;
  qty: number;
  unit_price: number;
  value: number;
};

export type DeliveryDoc = {
  doc_id: number;
  doc_number: string;
  doc_type: string;
  receipt_date: string;
  supplier: string | null;
  items_count: number;
  items_qty: number;
  net_pln: number;
  share_pct: number | null;
  items: DeliveryItem[];
};

/**
 * Dostawy per dokument PZ/PW - z przyjęć magazynowych wFirma (migracje 0012/0024/0025).
 * Filtry: zakres daty przyjęcia, typ dokumentu (PZ/PW/oba) i wyszukiwanie (dostawca, SKU, brand,
 * nazwa, nr dostawy). Filtry sprzedażowe (waluta/status/handlowiec) tu nie mają sensu - SQL je ignoruje.
 */
export async function getDeliveries(f: AnalyticsFilters): Promise<DeliveryDoc[]> {
  const limit = f.limit ?? 100;
  const needle = f.q?.trim().replace(/[%_,()]/g, "") || null;
  return rpc<DeliveryDoc>(
    "report_deliveries",
    {
      p_from: f.from ?? null,
      p_to: f.to ?? null,
      p_type: f.type ?? null,
      p_q: needle,
      p_sort: f.sort ?? null,
      p_dir: f.dir ?? null,
      p_limit: limit,
    },
    limit,
  );
}

// ============================================================
// Definicje raportów - jedno źródło prawdy dla ekranu i eksportu CSV,
// tak samo jak lib/report-columns.ts dla raportów szczegółowych.
// ============================================================

export type AggColType = "text" | "mono" | "number" | "money" | "share" | "change" | "date" | "days";

export type AggColumn = {
  key: keyof AggRow | string;
  header: string;
  type?: AggColType;
  align?: "right";
  grow?: boolean;
  /** Wartość parametru p_sort w funkcji SQL; brak = kolumna niesortowalna. */
  sort?: string;
};

const COL = {
  orders: { key: "orders_count", header: "Zamówień", type: "number", align: "right", sort: "orders" },
  companies: { key: "companies_count", header: "Kontrahentów", type: "number", align: "right", sort: "companies" },
  qty: { key: "items_qty", header: "Sztuk", type: "number", align: "right", sort: "qty" },
  net: { key: "net_pln", header: "Przychód netto PLN", type: "money", align: "right", sort: "net" },
  gross: { key: "gross_pln", header: "Brutto PLN", type: "money", align: "right", sort: "gross" },
  share: { key: "share_pct", header: "Udział", type: "share", align: "right" },
  avgOrder: { key: "avg_order_pln", header: "Śr. zamówienie", type: "money", align: "right", sort: "avg" },
} satisfies Record<string, AggColumn>;

export type ReportKey =
  | "podsumowanie" | "handlowcy" | "kontrahenci" | "produkty" | "zakupy" | "dostawy" | "okresy" | "kraje" | "struktura" | "uspieni";

export type ReportDef = {
  key: ReportKey;
  label: string;
  /** Zdanie tłumaczące, na co ten raport odpowiada - Katia nie zna nazw wymiarów z bazy. */
  hint: string;
  dim?: string;
  columns?: AggColumn[];
};

export const REPORTS: ReportDef[] = [
  { key: "podsumowanie", label: "Podsumowanie", hint: "Kluczowe liczby, trend miesięczny i czołówka klientów oraz produktów." },
  {
    key: "handlowcy",
    label: "Handlowcy",
    hint:
      "Sprzedaż wg opiekuna kontrahenta. Handlowiec jest przypisany do KLIENTA, nie do pojedynczego " +
      "zamówienia - tak samo liczy to EASI. Źródłem przypisań jest kartoteka EASI (zrzut z 21.07.2026), " +
      "bo API Turis tych danych nie udostępnia. Wiersz „(brak handlowca)” to klienci spoza kartoteki - " +
      "ich sprzedaż nie trafia do nikogo.",
    dim: "agent",
    columns: [
      { key: "label", header: "Handlowiec", type: "text", grow: true, sort: "label" },
      COL.companies,
      COL.orders,
      COL.qty,
      COL.net,
      COL.share,
      COL.avgOrder,
      { key: "first_order", header: "Pierwsze zamówienie", type: "date", sort: "first" },
      { key: "last_order", header: "Ostatnie zamówienie", type: "date", sort: "last" },
    ],
  },
  {
    key: "kontrahenci",
    label: "Kontrahenci",
    hint: "Kto kupuje najwięcej. Grupowane po kontrahencie, nie po nazwie z zamówienia - firma po zmianie nazwy zostaje jednym wierszem.",
    dim: "company",
    columns: [
      { key: "label", header: "Kontrahent", type: "text", grow: true, sort: "label" },
      { key: "sublabel", header: "NIP", type: "mono" },
      COL.orders,
      COL.qty,
      COL.net,
      COL.share,
      COL.avgOrder,
      { key: "first_order", header: "Pierwsze zamówienie", type: "date", sort: "first" },
      { key: "last_order", header: "Ostatnie zamówienie", type: "date", sort: "last" },
    ],
  },
  {
    key: "produkty",
    label: "Produkty",
    hint: "Co się sprzedaje. Kwoty z pozycji zamówień, czyli PRZED rabatem naliczanym na całym zamówieniu - suma będzie wyższa niż przychód z raportu zamówień.",
    columns: [
      { key: "label", header: "Kod produktu", type: "mono", sort: "label" },
      { key: "sublabel", header: "Nazwa produktu", type: "text", grow: true, sort: "name" },
      { key: "items_qty", header: "Sztuk", type: "number", align: "right", sort: "qty" },
      { key: "orders_count", header: "W zamówieniach", type: "number", align: "right", sort: "orders" },
      { key: "companies_count", header: "Kupujących", type: "number", align: "right", sort: "companies" },
      COL.net,
      COL.share,
      { key: "avg_price_pln", header: "Śr. cena netto", type: "money", align: "right", sort: "avg" },
      { key: "last_sale", header: "Ostatnia sprzedaż", type: "date", sort: "last" },
    ],
  },
  {
    key: "zakupy",
    label: "Zakupy",
    hint:
      "Zakupy towaru per produkt - z dokumentów przyjęć magazynowych wFirma (PW/PZ). Ilość przyjęta, " +
      "wartość zakupu netto w PLN i średnia (ważona) cena zakupu. To strona KOSZTOWA (ile i za ile " +
      "kupiliśmy), niezależna od sprzedaży. Cło i transport (koszty uboczne zakupu) NIE są tu jeszcze " +
      "rozbite na produkt - to osobne wydatki w wFirma, kwotami zbiorczymi na dostawę (patrz " +
      "docs/OTWARTE-PYTANIA.md A17). Dostawca dojdzie po dosynchronizowaniu nagłówków przyjęć. Filtruje " +
      "się zakresem daty przyjęcia i wyszukiwaniem; filtry sprzedażowe (waluta/status/handlowiec) tu nie działają.",
    columns: [
      { key: "label", header: "Kod / SKU", type: "mono", sort: "label" },
      { key: "sublabel", header: "Nazwa towaru", type: "text", grow: true, sort: "name" },
      { key: "items_qty", header: "Ilość przyjęta", type: "number", align: "right", sort: "qty" },
      { key: "orders_count", header: "Przyjęć", type: "number", align: "right", sort: "orders" },
      { key: "net_pln", header: "Wartość zakupu netto PLN", type: "money", align: "right", sort: "net" },
      { key: "avg_price_pln", header: "Śr. cena zakupu", type: "money", align: "right", sort: "avg" },
      COL.share,
      { key: "first_order", header: "Pierwsze przyjęcie", type: "date", sort: "first" },
      { key: "last_order", header: "Ostatnie przyjęcie", type: "date", sort: "last" },
    ],
  },
  {
    key: "dostawy",
    label: "Dostawy",
    hint:
      "Ruchy magazynowe per DOSTAWA (dokument przyjęcia wFirma). Domyślnie przyjęcia zewnętrzne (PZ) - " +
      "co, ile, po jakiej cenie i którego towaru (SKU + marka) przyjechało. Kliknij wiersz, żeby rozwinąć " +
      "pozycje dostawy. Przełącznik nad tabelą zmienia typ dokumentu (PZ / PW / oba). Marka pochodzi z Turis " +
      "przez dopasowanie towaru do produktu - towar bez dopasowanego produktu wyjdzie bez marki. Dostawca to " +
      "kontrahent z nagłówka przyjęcia. Kwoty w PLN netto. Filtruje się zakresem daty przyjęcia i wyszukiwaniem " +
      "(dostawca, SKU, marka, nazwa, nr dostawy); filtry sprzedażowe (waluta/status/handlowiec) tu nie działają.",
    // Kolumny renderuje własny komponent (rozwijane dostawy), nie generyczna tabela agregatów.
  },
  {
    key: "okresy",
    label: "Okresy",
    hint: "Jak sprzedaż zmienia się w czasie. Zmiana liczona do poprzedniego okresu na liście.",
    columns: [
      { key: "label", header: "Okres", type: "text", sort: "label" },
      COL.orders,
      COL.companies,
      COL.qty,
      COL.net,
      { key: "change_pct", header: "Zmiana", type: "change", align: "right" },
      COL.share,
      COL.avgOrder,
    ],
  },
  {
    key: "kraje",
    label: "Kraje",
    hint: "Sprzedaż eksportowa wg kraju kontrahenta.",
    dim: "country",
    columns: [
      { key: "label", header: "Kraj", type: "text", grow: true, sort: "label" },
      { key: "sublabel", header: "Kod", type: "mono" },
      COL.companies,
      COL.orders,
      COL.qty,
      COL.net,
      COL.share,
      COL.avgOrder,
    ],
  },
  {
    key: "struktura",
    label: "Struktura",
    hint: "Rozkład zamówień wg statusu, waluty, sposobu płatności, dopasowania faktur i dnia tygodnia.",
  },
  {
    key: "uspieni",
    label: "Uśpieni klienci",
    hint: "Kupowali, a od dłuższego czasu cisza - lista do odzyskania, licząc od największego historycznego przychodu. Liczone zawsze na całej historii, niezależnie od zakresu dat. Filtr „Handlowiec” zawęża listę do klientów jednego opiekuna.",
    columns: [
      { key: "label", header: "Kontrahent", type: "text", grow: true },
      { key: "sublabel", header: "NIP", type: "mono" },
      { key: "agent", header: "Handlowiec", type: "text" },
      { key: "days_since", header: "Dni bez zamówienia", type: "days", align: "right" },
      { key: "last_order", header: "Ostatnie zamówienie", type: "date" },
      { key: "orders_count", header: "Zamówień łącznie", type: "number", align: "right" },
      { key: "net_pln", header: "Przychód historyczny PLN", type: "money", align: "right" },
      { key: "avg_order_pln", header: "Śr. zamówienie", type: "money", align: "right" },
      { key: "first_order", header: "Klient od", type: "date" },
    ],
  },
];

export const REPORT_BY_KEY = Object.fromEntries(REPORTS.map((r) => [r.key, r])) as Record<ReportKey, ReportDef>;

export function isReportKey(v: string | undefined): v is ReportKey {
  return Boolean(v && v in REPORT_BY_KEY);
}

/** Granulacja dla zakładki "Okresy". */
export const PERIODS = [
  { key: "day", label: "Dni" },
  { key: "week", label: "Tygodnie" },
  { key: "month", label: "Miesiące" },
  { key: "quarter", label: "Kwartały" },
  { key: "year", label: "Lata" },
] as const;

export type PeriodKey = (typeof PERIODS)[number]["key"];

export function isPeriod(v: string | undefined): v is PeriodKey {
  return PERIODS.some((p) => p.key === v);
}

/** Małe tabele składające się na zakładkę "Struktura". */
export const STRUCTURE_BLOCKS = [
  { dim: "ctype", title: "Typ kontrahenta" },
  { dim: "status", title: "Status zamówienia" },
  { dim: "currency", title: "Waluta" },
  { dim: "payment", title: "Sposób płatności" },
  { dim: "match", title: "Dopasowanie faktury" },
  { dim: "dow", title: "Dzień tygodnia" },
] as const;

export const STRUCTURE_COLUMNS: AggColumn[] = [
  { key: "label", header: "Wartość", type: "text", grow: true },
  COL.orders,
  COL.net,
  COL.share,
];
