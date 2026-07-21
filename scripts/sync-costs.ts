/**
 * Sync kosztów własnych z wFirmy i przeliczenie CoGS. Użycie: npm run sync-costs
 *
 * Importy względne (nie @/...) - jak w backfill.ts, tsx nie rozwiązuje aliasów z tsconfig.
 */
import { syncGoods, syncReceiptLayers, mapProductsToGoods, applyCosts } from "../lib/sync/wfirma-costs";
import { refreshReports } from "../lib/sync/refresh-reports";
import { supabaseAdmin } from "../lib/supabase";

async function main() {
  console.log("== Kovas: koszty własne (wFirma) ==\n");

  console.log("-> towary...");
  const goods = await syncGoods();
  console.log(`   ${goods.upserted} towarów${goods.partial ? " - PRZERWANE limitem API" : ""}\n`);

  console.log("-> przyjęcia magazynowe (PW + PZ)...");
  const receipts = await syncReceiptLayers();
  console.log(`   ${receipts.docs} dokumentów, ${receipts.layers} warstw kosztowych${receipts.partial ? " - PRZERWANE limitem API" : ""}\n`);

  if (goods.partial || receipts.partial) {
    console.log("UWAGA: pobór niepełny (limit API wFirma). Koszty policzą się z tego, co jest -");
    console.log("uruchom `npm run sync-costs` ponownie później, żeby uzupełnić.\n");
  }

  console.log("-> mapowanie produktów Turis na towary wFirma...");
  const map = await mapProductsToGoods();
  console.log(`   dopasowane ${map.matched}, niedopasowane ${map.unmatched}`);
  console.log(`   po EAN: ${map.byKey.ean} | po SKU: ${map.byKey.code} | po nazwie: ${map.byKey.name}\n`);

  console.log("-> przeliczenie kosztów...");
  const applied = await applyCosts();
  console.log(`   produkty: ${applied.productsUpdated}, pozycje zamówień: ${applied.itemsUpdated}\n`);

  // Bez tego panel pokazywałby dalej zera - raporty stoją na migawce, nie na żywych tabelach
  console.log("-> odświeżanie migawki raportowej...");
  console.log(`   gotowe w ${((await refreshReports()) / 1000).toFixed(1)}s\n`);

  console.log("== Pokrycie kosztami (v_cost_coverage) ==");
  const { data, error } = await supabaseAdmin().from("v_cost_coverage").select("*");
  if (error) throw new Error(`odczyt v_cost_coverage: ${error.message}`);
  console.table(data);
}

main().catch((err) => {
  console.error("\nSync kosztów nie powiódł się:", err);
  process.exit(1);
});
