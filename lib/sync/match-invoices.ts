import "server-only";
import { supabaseAdmin, fetchAll } from "@/lib/supabase";

/**
 * Łączy faktury (invoices.parsed_order_number, wyciągnięte regexem z description przy syncu
 * wFirma) z zamówieniami (orders.display_order_number - unikalne w schemacie, więc "wiele
 * zamówień pod tym samym numerem" jest strukturalnie niemożliwe). Odwrotna niejednoznaczność -
 * wiele FAKTUR wskazujących na TO SAMO zamówienie (korekty, faktury częściowe) - jest możliwa
 * i realna, stąd downgrade do match_status='ambiguous' gdy order_id ma >1 dowiązaną fakturę.
 *
 * Pełne przeliczenie za każdym uruchomieniem (nie tylko 'pending') - tabela jest małego/średniego
 * rozmiaru, a poprawność > mikrooptymalizacja; bezpiecznie do wielokrotnego uruchamiania
 * (order_invoice_links ma unique(order_id, invoice_id), upsert nie duplikuje).
 */

const AMOUNT_TOLERANCE = 0.02;

type OrderLite = { id: number; display_order_number: string; grand_total_price: number | string | null };
type InvoiceLite = { id: number; parsed_order_number: string | null; total: number | string | null };

export async function matchInvoicesToOrders() {
  const db = supabaseAdmin();
  const { data: logRow } = await db
    .from("sync_log")
    .insert({ source: "order_invoice_matcher", run_type: "backfill", status: "running" })
    .select("id")
    .single();

  try {
    const [orders, invoices] = await Promise.all([
      fetchAll<OrderLite>("orders", "id, display_order_number, grand_total_price"),
      fetchAll<InvoiceLite>("invoices", "id, parsed_order_number, total"),
    ]);

    const orderByNumber = new Map((orders ?? []).map((o) => [o.display_order_number, o]));
    const linkRows: Record<string, unknown>[] = [];
    const invoiceStatus = new Map<number, string>();
    const invoiceCountPerOrder = new Map<number, number>();

    for (const inv of invoices ?? []) {
      if (!inv.parsed_order_number) {
        invoiceStatus.set(inv.id, "unparseable");
        continue;
      }
      const order = orderByNumber.get(inv.parsed_order_number);
      if (!order) {
        invoiceStatus.set(inv.id, "unmatched_no_order");
        continue;
      }
      const invTotal = inv.total !== null ? Number(inv.total) : null;
      const orderTotal = order.grand_total_price !== null ? Number(order.grand_total_price) : null;
      const amountMatches = invTotal !== null && orderTotal !== null ? Math.abs(invTotal - orderTotal) < AMOUNT_TOLERANCE : null;
      linkRows.push({
        order_id: order.id,
        invoice_id: inv.id,
        match_method: "description_regex",
        matched_order_number: inv.parsed_order_number,
        amount_matches: amountMatches,
        amount_diff: invTotal !== null && orderTotal !== null ? invTotal - orderTotal : null,
        confidence: amountMatches === false ? "low" : "high",
        matched_at: new Date().toISOString(),
      });
      invoiceCountPerOrder.set(order.id, (invoiceCountPerOrder.get(order.id) ?? 0) + 1);
      invoiceStatus.set(inv.id, `matched:${order.id}`); // tymczasowo koduje order_id, rozwiązywane niżej
    }

    // Kilka faktur na to samo zamówienie -> degradacja do 'ambiguous' (widoczne do ręcznego przeglądu)
    for (const [invId, status] of invoiceStatus) {
      if (status.startsWith("matched:")) {
        const orderId = Number(status.split(":")[1]);
        invoiceStatus.set(invId, (invoiceCountPerOrder.get(orderId) ?? 0) > 1 ? "ambiguous" : "matched");
      }
    }

    if (linkRows.length) {
      const { error } = await db.from("order_invoice_links").upsert(linkRows, { onConflict: "order_id,invoice_id" });
      if (error) throw new Error(`upsert order_invoice_links: ${error.message}`);
    }

    // UWAGA: celowo .update(), nie .upsert() - invoices.raw jest NOT NULL bez wartości domyślnej,
    // a Postgres buduje pełną kandydującą krotkę (z NULL w pominiętych kolumnach) ZANIM sprawdzi
    // konflikt, więc częściowy upsert łamałby się nawet dla już istniejących wierszy. .update()
    // dotyka tylko istniejących wierszy i nie buduje pełnej krotki - właściwe narzędzie do zmiany
    // jednej kolumny.
    const statusEntries = Array.from(invoiceStatus.entries());
    const CONCURRENCY = 25;
    for (let i = 0; i < statusEntries.length; i += CONCURRENCY) {
      const batch = statusEntries.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        batch.map(([id, match_status]) => db.from("invoices").update({ match_status }).eq("id", id))
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw new Error(`update invoices.match_status: ${failed.error.message}`);
    }

    await db
      .from("sync_log")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        records_seen: invoices?.length ?? 0,
        records_upserted: linkRows.length,
      })
      .eq("id", logRow?.id);

    return { invoicesProcessed: invoices?.length ?? 0, linksCreated: linkRows.length };
  } catch (err) {
    await db
      .from("sync_log")
      .update({ finished_at: new Date().toISOString(), status: "failed", error_message: String(err) })
      .eq("id", logRow?.id);
    throw err;
  }
}
