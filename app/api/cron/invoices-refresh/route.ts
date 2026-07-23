import { NextResponse, type NextRequest } from "next/server";
import { refreshRecentInvoices } from "@/lib/sync/wfirma";
import { matchInvoicesToOrders } from "@/lib/sync/match-invoices";
import { refreshReports } from "@/lib/sync/refresh-reports";

/**
 * Douczanie istniejących faktur (re-fetch, by wyłapać zmiany płatności/korekt na już zsynchronizowanych).
 *
 * WYŁĄCZONE z harmonogramu (nie ma go w vercel.json) - świadomie. Powód: ~99% faktur Kovas ma status
 * "nieopłacona", więc funkcja re-pobiera praktycznie całą historię faktur i nie mieści się w 300 s.
 * A skoro płatności prawdopodobnie nie są w wFirmie odznaczane (do potwierdzenia z Łukaszem), to
 * douczanie i tak nie miałoby czego wyłapać. Endpoint zostaje gotowy - by włączyć nocny przebieg,
 * dopisać wpis { path: "/api/cron/invoices-refresh", schedule: "0 2 * * *" } do vercel.json.
 * Wołany ręcznie (z sekretem) nadal działa - do testów po wyjaśnieniu sprawy płatności.
 */
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
    const invoicesRefresh = await refreshRecentInvoices();
    // Odświeżone kwoty/statusy faktur mogą zmienić dopasowania - przeliczamy tylko, gdy coś doszło.
    const dirty = !invoicesRefresh.skipped && invoicesRefresh.upserted > 0;
    const matched = dirty ? await matchInvoicesToOrders() : null;
    const refreshMs = dirty ? await refreshReports() : null;

    return NextResponse.json({
      ok: true,
      invoicesRefresh,
      matched,
      refreshed: dirty,
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
