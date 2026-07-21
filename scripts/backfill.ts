/**
 * Jednorazowy pełny backfill Turis + wFirma -> Supabase. Uruchamiane lokalnie (nie jako
 * Vercel Cron - ~700 stron zamówień przekracza sensowny czas funkcji serverless).
 * Użycie: npm run backfill
 *
 * Importy względne (nie @/...) - tsx nie rozwiązuje aliasów z tsconfig.json bez dodatkowej
 * konfiguracji, a to prostszy, pewny wybór dla jednorazowego skryptu.
 */
import { syncCompanies, syncProducts, syncAllOrders } from "../lib/sync/turis";
import { syncInvoices } from "../lib/sync/wfirma";
import { matchInvoicesToOrders } from "../lib/sync/match-invoices";
import { refreshReports } from "../lib/sync/refresh-reports";
import { supabaseAdmin } from "../lib/supabase";

async function main() {
  console.log("== Kovas backfill ==\n");

  console.log("-> kontrahenci (Turis)...");
  const companies = await syncCompanies();
  console.log(`   ${companies.upserted} kontrahentów\n`);

  console.log("-> produkty (Turis)...");
  const productIndex = await syncProducts();
  console.log(`   ${productIndex.validIds.size} produktów\n`);

  console.log("-> zamówienia (Turis, ~700 stron - może potrwać kilka minut)...");
  const orders = await syncAllOrders(productIndex, companies.validIds, (page, last) => {
    process.stdout.write(`\r   strona ${page}/${last}`);
  });
  console.log(`\n   ${orders.upserted} zamówień\n`);

  console.log("-> faktury (wFirma - limit API bywa przerywany, to oczekiwane)...");
  const invoices = await syncInvoices();
  console.log(
    `   ${invoices.upserted} faktur` +
      (invoices.partial ? " - PRZERWANE limitem API, uruchom `npm run backfill` ponownie później (wznowi się bezpiecznie)" : "") +
      "\n"
  );

  console.log("-> dopasowanie faktur do zamówień...");
  const matched = await matchInvoicesToOrders();
  console.log(`   ${matched.linksCreated} dopasowań na ${matched.invoicesProcessed} faktur\n`);

  // Migawka raportowa musi zobaczyć świeże dane - bez tego zakładka "Raporty" pokazywałaby
  // stan sprzed backfillu, wyglądający na aktualny
  console.log("-> odświeżanie migawki raportowej...");
  console.log(`   gotowe w ${(await refreshReports() / 1000).toFixed(1)}s\n`);

  console.log("== Jakość dopasowań (v_invoice_match_quality) ==");
  const { data: quality, error } = await supabaseAdmin().from("v_invoice_match_quality").select("*");
  if (error) throw new Error(`odczyt v_invoice_match_quality: ${error.message}`);
  console.table(quality);
}

main().catch((err) => {
  console.error("\nBackfill nie powiódł się:", err);
  process.exit(1);
});
