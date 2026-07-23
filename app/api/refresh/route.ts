import { NextResponse } from "next/server";
import { syncCompanies, syncProducts, syncOrdersDelta, syncOpenOrders } from "@/lib/sync/turis";
import { syncInvoices } from "@/lib/sync/wfirma";
import { matchInvoicesToOrders } from "@/lib/sync/match-invoices";
import { refreshReports, warmReports } from "@/lib/sync/refresh-reports";
import { getCurrentUser } from "@/lib/auth";

/**
 * Ręczne odświeżenie z panelu (przycisk w nagłówku). Odpala CAŁY cykl naraz - to, co crony robią
 * osobno (Turis co 15 min, wFirma co godzinę): nowe zamówienia + statusy otwartych z Turis oraz
 * nowe faktury z wFirmy, dopasowanie faktur do zamówień i przeliczenie migawki raportowej.
 *
 * Autoryzacja przez sesję zalogowanego (ciasteczka), NIE przez CRON_SECRET - sekret crona nie może
 * trafić do przeglądarki. Endpoint jest chroniony tak samo jak reszta panelu: brak konta = 401.
 */

// wFirma bywa wolna (backoff na limicie) - pełne 300 s zapasu (plan Pro), jak w cronie faktur.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    // Kolejność jak w cronie Turis: firmy i produkty PRZED zamówieniami (FK), potem delta + otwarte.
    const companies = await syncCompanies();
    const products = await syncProducts();
    const orders = await syncOrdersDelta(products, companies.validIds, "manual");
    const openOrders = await syncOpenOrders(products, companies.validIds, "manual");
    // Faktury z wFirmy - przyrostowo, jak w cronie faktur.
    const invoices = await syncInvoices();
    // Po dociągnięciu zamówień i faktur dopasowujemy je do siebie, potem migawka.
    const matched = await matchInvoicesToOrders();
    // Migawkę przeliczamy tylko, gdy w tym przebiegu faktycznie coś wpadło - inaczej marnujemy
    // pełny refresh materialized view. Cache rozgrzewamy zawsze (po refreshu cache migawki jest zimny).
    const reportsDirty =
      orders.upserted > 0 || openOrders.upserted > 0 || invoices.upserted > 0 || matched.linksCreated > 0;
    const refreshMs = reportsDirty ? await refreshReports() : null;
    const warmMs = await warmReports();

    return NextResponse.json({
      ok: true,
      companies: companies.upserted,
      products: products.validIds.size,
      orders: { seen: orders.seen, upserted: orders.upserted },
      openOrders,
      invoices: { upserted: invoices.upserted, partial: invoices.partial },
      matched,
      refreshed: reportsDirty,
      refreshMs,
      warmMs,
      totalMs: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), totalMs: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
