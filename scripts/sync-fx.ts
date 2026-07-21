import { fetchRates } from "../lib/nbp";
import { supabaseAdmin } from "../lib/supabase";
import { refreshReports } from "../lib/sync/refresh-reports";

/**
 * Pobiera kursy NBP dla walut występujących w zamówieniach i zapisuje do fx_rates.
 * Uruchamianie: npm run sync-fx
 *
 * Idempotentny (upsert po kluczu currency+effective_date), więc można puszczać wielokrotnie.
 * Zakres: od pierwszego zamówienia (minus zapas na "dzień poprzedzający") do dziś.
 */

async function main() {
  const db = supabaseAdmin();

  const { data: currencies, error: curError } = await db.from("orders").select("currency_code");
  if (curError) throw new Error(`odczyt walut: ${curError.message}`);
  const used = [...new Set((currencies ?? []).map((r: { currency_code: string | null }) => r.currency_code))]
    .filter((c): c is string => Boolean(c) && c !== "PLN"); // PLN nie ma kursu do samego siebie

  const { data: firstOrder, error: dateError } = await db
    .from("orders")
    .select("turis_created_at")
    .order("turis_created_at", { ascending: true })
    .limit(1)
    .single();
  if (dateError) throw new Error(`odczyt najstarszego zamówienia: ${dateError.message}`);

  // 10 dni zapasu wstecz: dla zamówienia z poniedziałku po długim weekendzie
  // ostatnie notowanie może być sprzed kilku dni
  const start = new Date(new Date(firstOrder.turis_created_at as string).getTime() - 10 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  console.log(`Waluty w zamówieniach: ${used.join(", ")}`);
  console.log(`Zakres: ${start} .. ${today}\n`);

  for (const currency of used) {
    const rates = await fetchRates(currency, start, today);
    if (!rates.length) {
      console.log(`${currency}: brak notowań w zakresie`);
      continue;
    }
    // porcjami - jeden upsert kilku tysięcy wierszy potrafi przekroczyć limit payloadu
    for (let i = 0; i < rates.length; i += 500) {
      const { error } = await db.from("fx_rates").upsert(rates.slice(i, i + 500), { onConflict: "currency,effective_date" });
      if (error) throw new Error(`zapis ${currency}: ${error.message}`);
    }
    console.log(`${currency}: ${rates.length} notowań (${rates[0].effective_date} .. ${rates[rates.length - 1].effective_date})`);
  }

  // Kursy wchodzą do kwot w PLN i EUR, a te są policzone w migawce mv_report_orders, z której
  // czyta zarówno lista zamówień, jak i kafelki sum (migracja 0010). Bez odświeżenia panel
  // pokazywałby stare przeliczenia mimo pobrania świeżych notowań - czyli dokładnie ten problem,
  // przed którym ostrzega komunikat "uruchom npm run sync-fx".
  console.log("\n-> odświeżanie migawki raportowej...");
  console.log(`   gotowe w ${((await refreshReports()) / 1000).toFixed(1)}s`);

  console.log("\nGotowe.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
