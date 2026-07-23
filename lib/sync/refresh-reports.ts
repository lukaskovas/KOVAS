import { supabaseAdmin } from "../supabase";

/**
 * Przelicza migawkę mv_report_orders, na której stoi cała zakładka "Raporty".
 *
 * Migawka istnieje, bo v_orders_report ma lateral joiny do kursów i faktur - liczenie go
 * od nowa przy każdym raporcie potrafiło przekroczyć limit czasu zapytania po stronie API.
 * Cena jest taka, że po zmianie danych trzeba ją odświeżyć; robi to backfill na koniec
 * i `npm run refresh-reports`.
 */
export async function refreshReports(): Promise<number> {
  const started = Date.now();
  const { error } = await supabaseAdmin().rpc("refresh_reports");
  if (error) throw new Error(`refresh_reports: ${error.message}`);
  return Date.now() - started;
}

/**
 * Rozgrzewa cache bazy dla ciężkiej ścieżki "Sprzedaż produktów" (skan v_order_items_report,
 * na zimno ~5 s, na ciepło ~0,5 s). Domyślne KPI zamówień NIE jest już tu rozgrzewane - trafia
 * do gotowego snapshotu (refresh_kpi_snapshot w refresh_reports, migracja 0027), więc panel
 * czyta je natychmiast bez zależności od gorącego cache.
 *
 * Błędów NIE propagujemy - to optymalizacja, a nie krok krytyczny synchronizacji; gdyby
 * rozgrzewka padła, sync i tak jest udany. Zwraca czas dla logów.
 */
export async function warmReports(): Promise<number> {
  const started = Date.now();
  try {
    await supabaseAdmin().from("v_order_items_report").select("id").limit(1);
  } catch {
    // celowo połknięte - patrz opis funkcji
  }
  return Date.now() - started;
}
