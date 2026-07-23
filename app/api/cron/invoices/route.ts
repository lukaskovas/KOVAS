import { NextResponse, type NextRequest } from "next/server";
import { syncInvoices } from "@/lib/sync/wfirma";
import { matchInvoicesToOrders } from "@/lib/sync/match-invoices";
import { refreshReports } from "@/lib/sync/refresh-reports";

/**
 * Cron wFIRMA - co godzinę (harmonogram w vercel.json), osobno od crona Turis.
 * Powód rozdzielenia: faktury/koszty zmieniają się wolniej niż zamówienia, a API wFirmy ma
 * limit - trzymanie tego w cronie co 15 min wywalało budżet czasu funkcji.
 *
 * Kroki: dociągnięcie NOWYCH faktur (przyrostowo, wznawialne), dopasowanie do zamówień,
 * odświeżenie migawki raportowej. Mieści się w kilkudziesięciu sekundach.
 *
 * UWAGA: refreshRecentInvoices (douczanie istniejących faktur z okna 45 dni) NIE jest tu wołane -
 * re-pobiera ~1200+ faktur i nie mieści się w 300 s jednej funkcji. Wymaga osobnego podejścia
 * (wznawialność / mniejsze okno / własny rzadszy cron) - do ustalenia.
 */

// wFirma bywa wolna (backoff na limicie) - pełne 300 s zapasu (plan Pro)
export const maxDuration = 300;
export const dynamic = "force-dynamic";

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
    const invoices = await syncInvoices();
    const matched = await matchInvoicesToOrders();
    // Przeliczamy migawkę tylko gdy doszły nowe faktury lub powstały nowe dopasowania do zamówień.
    const reportsDirty = invoices.upserted > 0 || matched.linksCreated > 0;
    const refreshMs = reportsDirty ? await refreshReports() : null;

    return NextResponse.json({
      ok: true,
      invoices: { upserted: invoices.upserted, partial: invoices.partial },
      matched,
      refreshed: reportsDirty,
      refreshMs,
      totalMs: Date.now() - startedAt,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: String(err), totalMs: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
