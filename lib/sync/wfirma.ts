import "server-only";
import { findInvoicesSince, WfirmaRateLimitError } from "@/lib/wfirma";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Sync wFirma -> Supabase (invoices). Kursor po najwyższym już zapisanym Invoice.id
 * (nie po dacie modyfikacji - API tego nie udostępnia, patrz research-wfirma.md).
 * Limit API wFirma jest realny i przerywany (potwierdzone w logach 2026-07-21) - stąd
 * checkpoint PO KAŻDEJ STRONIE (przerwany run nie traci postępu) + backoff + circuit
 * breaker (dwie strony pod rząd na limicie -> kończymy run jako 'partial', nie crash).
 */

const PAGE_SIZE = 100;
const BACKOFF_MS = [30_000, 60_000, 120_000, 240_000];
const MAX_CONSECUTIVE_LIMIT_PAGES = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyToNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function extractInvoiceRow(inv: Record<string, unknown>) {
  const description = emptyToNull(inv.description);
  const match = description ? /Order:\s*(\S+)/i.exec(description) : null;
  const contractor = inv.contractor as { name?: string } | undefined;
  const companyDetail = inv.company_detail as { name?: string } | undefined;
  return {
    id: Number(inv.id),
    fullnumber: inv.fullnumber ?? null,
    description,
    parsed_order_number: match?.[1] ?? null,
    invoice_type: inv.type ?? null,
    invoice_date: emptyToNull(inv.date),
    paymentstate: inv.paymentstate ?? null,
    total: inv.total ?? null,
    currency: inv.currency ?? null,
    currency_exchange: inv.currency_exchange ?? null,
    currency_label: emptyToNull(inv.currency_label),
    currency_date: emptyToNull(inv.currency_date),
    contractor_name: contractor?.name ?? companyDetail?.name ?? null,
    raw: inv,
    synced_at: new Date().toISOString(),
  };
}

/** Pobiera jedną stronę z retry/backoff na WfirmaRateLimitError. Zwraca null po wyczerpaniu prób. */
async function fetchPageWithRetry(sinceId: number): Promise<Record<string, unknown>[] | null> {
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      return await findInvoicesSince(sinceId, PAGE_SIZE);
    } catch (err) {
      if (!(err instanceof WfirmaRateLimitError)) throw err;
      if (attempt === BACKOFF_MS.length) return null; // wyczerpane próby dla tej strony
      await sleep(BACKOFF_MS[attempt]);
    }
  }
  return null;
}

export async function syncInvoices() {
  const db = supabaseAdmin();
  const { data: logRow } = await db
    .from("sync_log")
    .insert({ source: "wfirma_invoices", run_type: "backfill", status: "running" })
    .select("id")
    .single();

  const { data: maxRow } = await db.from("invoices").select("id").order("id", { ascending: false }).limit(1).maybeSingle();
  let cursor = (maxRow?.id as number | undefined) ?? 0;
  const cursorFrom = cursor;

  let seen = 0;
  let upserted = 0;
  let consecutiveLimitPages = 0;
  let partial = false;

  try {
    for (;;) {
      const page = await fetchPageWithRetry(cursor);
      if (page === null) {
        consecutiveLimitPages++;
        if (consecutiveLimitPages >= MAX_CONSECUTIVE_LIMIT_PAGES) {
          partial = true;
          break;
        }
        continue; // spróbuj tej samej strony (tego samego kursora) jeszcze raz w następnej iteracji
      }
      consecutiveLimitPages = 0;
      if (page.length === 0) break; // koniec danych - sukces

      seen += page.length;
      const rows = page.map(extractInvoiceRow);
      const { error } = await db.from("invoices").upsert(rows);
      if (error) throw new Error(`upsert invoices (od id ${cursor}): ${error.message}`);
      upserted += rows.length;

      cursor = Math.max(...rows.map((r) => r.id));
      // checkpoint po KAŻDEJ stronie - przerwany run nie traci postępu
      await db
        .from("sync_log")
        .update({ records_seen: seen, records_upserted: upserted, cursor_from: String(cursorFrom), cursor_to: String(cursor) })
        .eq("id", logRow?.id);

      if (page.length < PAGE_SIZE) break; // ostatnia niepełna strona - koniec danych
    }

    await db
      .from("sync_log")
      .update({
        finished_at: new Date().toISOString(),
        status: partial ? "partial" : "success",
        records_seen: seen,
        records_upserted: upserted,
        error_message: partial ? "Przerwano: limit API wFirma przekroczony na dwóch stronach pod rząd" : null,
      })
      .eq("id", logRow?.id);

    return { seen, upserted, partial, cursorFrom, cursorTo: cursor };
  } catch (err) {
    await db
      .from("sync_log")
      .update({ finished_at: new Date().toISOString(), status: "failed", error_message: String(err) })
      .eq("id", logRow?.id);
    throw err;
  }
}
