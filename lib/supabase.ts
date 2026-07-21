import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Klient Supabase z service_role key - omija RLS, dlatego tylko server-side
 * (sync jobs, API routes, server components). Nigdy we frontendzie.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Bez wygenerowanego typu Database (nie ma jeszcze żywego projektu, więc nie ma z czego go
// wygenerować - `supabase gen types` to zadanie na później, po Kroku 0 z planu). Generic <any>
// zamiast domyślnego - inaczej postgrest-js zawęża typy wierszy do `never` pod strict TS.
let client: ReturnType<typeof createClient<any>> | null = null;

export function supabaseAdmin() {
  if (client) return client;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Brak konfiguracji Supabase (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY w .env.local)");
  }
  client = createClient<any>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  return client;
}

const RANGE_PAGE_SIZE = 1000;

/**
 * PostgREST domyślnie ucina niepaginowane select() do limitu wierszy (empirycznie 1000 na tym
 * projekcie, bez błędu - po prostu cicho zwraca mniej niż jest w tabeli/widoku). Użyj tego
 * zamiast gołego .select() wszędzie, gdzie faktycznie potrzebny jest KOMPLETNY zbiór (np. sync,
 * matcher) - nie do stronicowanych widoków raportowych w UI, gdzie i tak chcemy tylko jedną stronę.
 */
export async function fetchAll<T>(from: string, select: string): Promise<T[]> {
  const db = supabaseAdmin();
  const all: T[] = [];
  let page = 0;
  for (;;) {
    const { data, error } = await db
      .from(from)
      .select(select)
      .range(page * RANGE_PAGE_SIZE, (page + 1) * RANGE_PAGE_SIZE - 1);
    if (error) throw new Error(`fetch ${from}: ${error.message}`);
    all.push(...((data ?? []) as T[]));
    if (!data || data.length < RANGE_PAGE_SIZE) break;
    page++;
  }
  return all;
}
