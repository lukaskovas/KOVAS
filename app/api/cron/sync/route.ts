import { NextResponse, type NextRequest } from "next/server";
import { syncCompanies, syncProducts, syncOrdersDelta, syncOpenOrders } from "@/lib/sync/turis";
import { matchInvoicesToOrders } from "@/lib/sync/match-invoices";
import { refreshReports, warmReports } from "@/lib/sync/refresh-reports";

/**
 * Cron TURIS - co 15 minut (harmonogram w vercel.json). Szybka pętla: firmy, produkty,
 * nowe zamówienia (delta) i statusy otwartych zamówień. Faktury wFirmy są w OSOBNYM cronie
 * (/api/cron/invoices, co godzinę) - są wolne przez limit API wFirmy i zmieniają się rzadziej,
 * więc trzymanie ich tutaj wywalało budżet czasu funkcji (całość > 300 s).
 *
 * Kolejność: firmy i produkty PRZED zamówieniami (FK), potem dopasowanie faktur do (być może
 * nowych) zamówień i odświeżenie migawki raportowej na końcu.
 *
 * Zamówienia: syncOrdersDelta dokłada NOWE (endpoint orders/created), syncOpenOrders odświeża
 * statusy otwartych (nie Shipped/Completed) - razem pokrywają cykl życia zamówienia bez webhooków.
 * Pełny backfill historii uruchamia się raz, lokalnie (npm run backfill).
 */

export const maxDuration = 120;
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
    // Po dociągnięciu nowych zamówień odświeżamy statusy tych otwartych (nie Shipped/Completed) -
    // łapie przejście "otwarte -> wysłane" bez zepsutego orders/updated i bez webhooków.
    const openOrders = await syncOpenOrders(products, companies.validIds, "cron");
    // Nowe zamówienia mogą pasować do faktur, które przyszły wcześniej - dopasowujemy, potem raporty.
    const matched = await matchInvoicesToOrders();
    // Migawkę raportową (mv_report_orders) przeliczamy TYLKO, gdy w tym przebiegu faktycznie coś
    // wpadło: nowe zamówienia, odświeżone otwarte (mógł się zmienić status) lub nowe dopasowania
    // faktur. Pusty kwadrans (noc/weekend, zero ruchu) nie marnuje pełnego refresh materialized view.
    const reportsDirty = orders.upserted > 0 || openOrders.upserted > 0 || matched.linksCreated > 0;
    const refreshMs = reportsDirty ? await refreshReports() : null;
    // Rozgrzewamy cache ciężkich ścieżek panelu ZAWSZE (nawet w pusty kwadrans i po refreshu,
    // który czyści cache migawki) - żeby pierwszy użytkownik nie trafił w zimny start ~12 s.
    const warmMs = await warmReports();

    return NextResponse.json({
      ok: true,
      companies: companies.upserted,
      products: products.validIds.size,
      orders: { seen: orders.seen, upserted: orders.upserted, from: orders.fromSec, to: orders.toSec },
      openOrders,
      matched,
      refreshed: reportsDirty,
      refreshMs,
      warmMs,
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
