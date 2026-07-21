import "server-only";

/**
 * Konektor do API Turis (https://<konto>.turis.app/api/public/v1).
 * Autoryzacja: OAuth2 client_credentials -> Bearer token (ważny ~1 rok).
 * Token cache'owany w pamięci procesu. Cała komunikacja po stronie serwera -
 * client_secret nigdy nie trafia do przeglądarki.
 */

const BASE_URL = process.env.TURIS_BASE_URL;
const CLIENT_ID = process.env.TURIS_CLIENT_ID;
const CLIENT_SECRET = process.env.TURIS_CLIENT_SECRET;

type TokenCache = { token: string; expiresAt: number };
let cache: TokenCache | null = null;

async function getToken(): Promise<string> {
  if (cache && cache.expiresAt > Date.now() + 60_000) return cache.token;
  if (!BASE_URL || !CLIENT_ID || !CLIENT_SECRET) {
    throw new Error("Brak konfiguracji Turis (TURIS_BASE_URL / TURIS_CLIENT_ID / TURIS_CLIENT_SECRET w .env.local)");
  }
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
  });
  const res = await fetch(`${BASE_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: body.toString(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Turis /oauth/token -> HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cache = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return cache.token;
}

export type Paginated<T> = {
  data: T[];
  meta?: { current_page: number; last_page: number; per_page: number; total: number };
};

/** Eksportowane dla lib/sync/turis.ts - potrzebuje pełnych, niezawężonych payloadów (backfill do Supabase). */
export async function turisGet<T>(path: string, params?: Record<string, string | number>): Promise<Paginated<T>> {
  const token = await getToken();
  const url = new URL(`${BASE_URL}/api/public/v1/${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    // krótkie cache - powrót do tej samej zakładki jest natychmiastowy,
    // a dane i tak odświeżają się co minutę
    next: { revalidate: 60 },
  });
  if (!res.ok) throw new Error(`Turis GET ${path} -> HTTP ${res.status}`);
  const json = await res.json();
  // Turis zwraca albo { data, meta, links } (paginacja), albo { data } (pełna lista)
  return { data: json.data ?? json, meta: json.meta };
}

/* ---- Typy pól, które faktycznie wyświetlamy (reszta pól z API pominięta) ---- */

export type Order = {
  id: number;
  display_order_number: string;
  company_name: string | null;
  current_status: { id: number; name: string } | null;
  status: string | null;
  grand_total: number | string | null;
  currency: { code: string; symbol: string; id: number } | null;
  items_count: number | null;
  invoice_id: number | null;
  created_at: string | null;
};

export type Company = {
  id: number;
  name: string;
  vat_number: string | null;
  city: string | null;
  country: string | null;
  email: string | null;
  discount: number | string | null;
  credit_limit: number | string | null;
};

export type Product = {
  id: number;
  name: string;
  sku: string | null;
  ean: string | null;
  unit_cost: number | string | null;
  stock: number | string | null;
  brand_id: number | null;
};

/**
 * Zamówienia od NAJNOWSZYCH. Turis zwraca rosnąco (najstarsze pierwsze) i nie ma parametru
 * sortowania. Odwracamy kolejność zachowując pełne strony: strona 1 = 15 najnowszych,
 * a niepełna "reszta z dzielenia" ląduje na ostatniej (najstarszej) stronie.
 * Blok 15 pozycji obejmuje maks. 2 sąsiednie strony API - tyle pobieramy.
 */
export async function getOrders(displayPage = 1): Promise<Paginated<Order>> {
  const perPage = 15;
  const first = await turisGet<Order>("orders", { page: 1 });
  const meta = first.meta;
  if (!meta) return first;
  const total = meta.total;
  const displayLast = Math.max(1, Math.ceil(total / perPage));
  const mappedMeta = { current_page: displayPage, last_page: displayLast, per_page: perPage, total };
  if (displayPage < 1 || displayPage > displayLast) return { data: [], meta: mappedMeta };

  // indeksy "od najnowszych" (0 = najnowszy) -> pozycje rosnące w API (0 = najstarszy)
  const startIdx = (displayPage - 1) * perPage;
  const endIdx = Math.min(startIdx + perPage - 1, total - 1);
  const posLow = total - 1 - endIdx;
  const posHigh = total - 1 - startIdx;
  const pStart = Math.floor(posLow / perPage) + 1;
  const pEnd = Math.floor(posHigh / perPage) + 1;

  const ascending: Order[] = [];
  for (let p = pStart; p <= pEnd; p++) {
    const pg = p === 1 ? first : await turisGet<Order>("orders", { page: p });
    ascending.push(...pg.data);
  }
  const base = (pStart - 1) * perPage;
  const block = ascending.slice(posLow - base, posHigh - base + 1);
  return { data: block.reverse(), meta: mappedMeta };
}

export const getCompanies = () => turisGet<Company>("companies");
export const getProducts = () => turisGet<Product>("products");
