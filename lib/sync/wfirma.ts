import "server-only";
import {
  findInvoicesSince,
  findInvoicesByDateSince,
  findUnpaidInvoicesBefore,
  WfirmaRateLimitError,
} from "@/lib/wfirma";
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
    payment_method: emptyToNull(inv.paymentmethod),
    payment_due_date: emptyToNull(inv.paymentdate),
    amount_paid: emptyToNull(inv.alreadypaid),
    amount_remaining: emptyToNull(inv.remaining),
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
async function fetchPageWithRetry(
  fetchPage: () => Promise<Record<string, unknown>[]>
): Promise<Record<string, unknown>[] | null> {
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      return await fetchPage();
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
      const page = await fetchPageWithRetry(() => findInvoicesSince(cursor, PAGE_SIZE));
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

const REFRESH_SOURCE = "wfirma_invoices_refresh";
const REFRESH_DAYS = 45;
// Bramka: re-fetch całego okna (+ starych nieopłaconych) raz na dobę, nie co cykl - żeby nie
// dokładać presji na współdzielony limit API wFirma. 20h < 24h daje zapas, żeby przebieg nie
// "przesuwał się" po dobie i nie wypadał czasem dwa razy dziennie, a czasem wcale.
const REFRESH_MIN_INTERVAL_H = 20;

/**
 * Przepuszcza stronicowany fetcher (page -> wiersze) przez ten sam mechanizm co syncInvoices:
 * retry/backoff na limicie, circuit breaker (dwie strony pod rząd na limicie -> partial),
 * checkpoint co stronę. Zwraca zliczenia i flagę partial. Nie loguje sam - robi to wołający.
 */
async function drainPages(
  db: ReturnType<typeof supabaseAdmin>,
  logId: number | undefined,
  fetchPage: (page: number) => Promise<Record<string, unknown>[]>,
  base: { seen: number; upserted: number }
): Promise<{ seen: number; upserted: number; partial: boolean }> {
  let { seen, upserted } = base;
  let page = 1;
  let consecutiveLimitPages = 0;

  for (;;) {
    const rows = await fetchPageWithRetry(() => fetchPage(page));
    if (rows === null) {
      consecutiveLimitPages++;
      if (consecutiveLimitPages >= MAX_CONSECUTIVE_LIMIT_PAGES) return { seen, upserted, partial: true };
      continue; // ta sama strona jeszcze raz
    }
    consecutiveLimitPages = 0;
    if (rows.length === 0) break;

    seen += rows.length;
    const mapped = rows.map(extractInvoiceRow);
    const { error } = await db.from("invoices").upsert(mapped);
    if (error) throw new Error(`upsert invoices refresh (strona ${page}): ${error.message}`);
    upserted += mapped.length;

    await db.from("sync_log").update({ records_seen: seen, records_upserted: upserted }).eq("id", logId);

    if (rows.length < PAGE_SIZE) break; // ostatnia niepełna strona
    page++;
  }
  return { seen, upserted, partial: false };
}

/**
 * Douczanie ISTNIEJĄCYCH faktur - re-fetch pełnych obiektów, żeby zmiany naniesione w wFirma na
 * już zsynchronizowanych fakturach (korekta, kwota, status zapłaty) trafiły do bazy. syncInvoices
 * tego nie robi (kursor po max id -> tylko nowe). Dwa zbiory, bez nakładania:
 *   1) wszystkie faktury z ostatnich REFRESH_DAYS dni (date >= cutoff),
 *   2) nieopłacone wystawione wcześniej (paymentstate=unpaid AND date < cutoff).
 * Bramkowane czasowo (REFRESH_MIN_INTERVAL_H) - zwraca { skipped: true }, jeśli ostatni przebieg
 * był zbyt niedawno, więc można je wołać z crona co 15 min bez efektu poza jednym oknem na dobę.
 */
export async function refreshRecentInvoices(days = REFRESH_DAYS) {
  const db = supabaseAdmin();

  const { data: lastRun } = await db
    .from("sync_log")
    .select("started_at")
    .eq("source", REFRESH_SOURCE)
    .in("status", ["success", "partial"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastRun?.started_at) {
    const hoursSince = (Date.now() - new Date(lastRun.started_at).getTime()) / 3_600_000;
    if (hoursSince < REFRESH_MIN_INTERVAL_H) {
      return { skipped: true, seen: 0, upserted: 0, partial: false };
    }
  }

  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10); // YYYY-MM-DD

  const { data: logRow } = await db
    .from("sync_log")
    .insert({ source: REFRESH_SOURCE, run_type: "cron", status: "running", cursor_from: cutoff })
    .select("id")
    .single();
  const logId = logRow?.id as number | undefined;

  try {
    const recent = await drainPages(db, logId, (page) => findInvoicesByDateSince(cutoff, page, PAGE_SIZE), { seen: 0, upserted: 0 });
    const total = await drainPages(db, logId, (page) => findUnpaidInvoicesBefore(cutoff, page, PAGE_SIZE), {
      seen: recent.seen,
      upserted: recent.upserted,
    });
    const partial = recent.partial || total.partial;

    await db
      .from("sync_log")
      .update({
        finished_at: new Date().toISOString(),
        status: partial ? "partial" : "success",
        records_seen: total.seen,
        records_upserted: total.upserted,
        error_message: partial ? "Przerwano: limit API wFirma przekroczony na dwóch stronach pod rząd" : null,
      })
      .eq("id", logId);

    return { skipped: false, seen: total.seen, upserted: total.upserted, partial, cutoff };
  } catch (err) {
    await db
      .from("sync_log")
      .update({ finished_at: new Date().toISOString(), status: "failed", error_message: String(err) })
      .eq("id", logId);
    throw err;
  }
}
