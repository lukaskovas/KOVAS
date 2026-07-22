import { NextResponse, type NextRequest } from "next/server";
import { syncCompanies, syncProducts, syncOrdersDelta } from "@/lib/sync/turis";
import { syncInvoices } from "@/lib/sync/wfirma";
import { matchInvoicesToOrders } from "@/lib/sync/match-invoices";
import { refreshReports } from "@/lib/sync/refresh-reports";

/**
 * Cykliczna synchronizacja danych (Turis + wFirma) -> Supabase, uruchamiana przez Vercel Cron
 * co 15 minut (harmonogram w vercel.json). Kolejność ma znaczenie:
 * firmy i produkty PRZED zamówieniami (FK orders.company_id, order_items.product_id),
 * zamówienia PRZED dopasowaniem faktur, wszystko PRZED odświeżeniem migawki raportowej.
 *
 * Zamówienia idą trybem przyrostowym (syncOrdersDelta - tylko zmiany od ostatniego przebiegu),
 * nie pełnym backfillem, bo ~700 stron nie zmieściłoby się w limicie czasu funkcji.
 * Pełny backfill historii uruchamia się raz, lokalnie (npm run backfill).
 */

// Pro pozwala do 300 s - z zapasem, bo delta jest zwykle mała, ale wFirma bywa wolna przy limicie API
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Vercel Cron dołącza automatycznie nagłówek `Authorization: Bearer <CRON_SECRET>`, jeśli zmienna
 * CRON_SECRET jest ustawiona w projekcie. Ten sam nagłówek pozwala odpalić sync ręcznie (debug).
 * Bez sekretu (albo z błędnym) - 401, żeby endpoint nie był publicznym przyciskiem "obciąż nasze API".
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const companies = await syncCompanies();
    const products = await syncProducts();
    const orders = await syncOrdersDelta(products, companies.validIds, "cron");
    const invoices = await syncInvoices();
    const matched = await matchInvoicesToOrders();
    const refreshMs = await refreshReports();

    return NextResponse.json({
      ok: true,
      companies: companies.upserted,
      products: products.validIds.size,
      orders: { seen: orders.seen, upserted: orders.upserted, from: orders.fromSec, to: orders.toSec },
      invoices: { upserted: invoices.upserted, partial: invoices.partial },
      matched,
      refreshMs,
      totalMs: Date.now() - startedAt,
    });
  } catch (err) {
    // 500, żeby Vercel Cron oznaczył przebieg jako nieudany i było to widać w logach
    return NextResponse.json(
      { ok: false, error: String(err), totalMs: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
