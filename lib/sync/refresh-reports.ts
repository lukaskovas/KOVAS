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
