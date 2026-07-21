/**
 * Odświeżenie migawki raportowej mv_report_orders (migracja 0007_analytics.sql).
 * Użycie: npm run refresh-reports
 *
 * Potrzebne po każdej zmianie danych źródłowych - backfill robi to sam na koniec, ten skrypt
 * jest do sytuacji, gdy dane zmieniły się inaczej (ręczna poprawka, ponowny sync kursów).
 * Bez odświeżenia zakładka "Raporty" pokazuje stan z ostatniego przeliczenia.
 */
import { refreshReports } from "../lib/sync/refresh-reports";

async function main() {
  console.log("-> odświeżanie migawki raportowej...");
  const ms = await refreshReports();
  console.log(`   gotowe w ${(ms / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error("\nOdświeżenie nie powiodło się:", err);
  process.exit(1);
});
