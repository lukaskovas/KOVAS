import "server-only";
import { Client } from "pg";
import { findGoodsPage, findWarehouseDocsPage, unwrapDocContents, WfirmaRateLimitError } from "@/lib/wfirma";
import { supabaseAdmin, fetchAll } from "@/lib/supabase";

/**
 * Sync kosztów własnych: wFirma (towary + przyjęcia magazynowe) -> Supabase.
 *
 * Kontekst: Turis nie zawiera żadnych danych kosztowych (products.unit_cost było zerowe
 * w 100% pozycji), więc CoGS i marża w panelu były fikcyjne. Realny koszt jest w dokumentach
 * przyjęć wFirma. Szczegóły i materiał dowodowy: docs/analiza-easi/LUKI-DANYCH.md sekcja 7.1.
 *
 * Kolejność ma znaczenie: towary -> przyjęcia -> mapowanie -> przeliczenie kosztów.
 */

const PAGE_SIZE = 100;
const BACKOFF_MS = [30_000, 60_000, 120_000, 240_000];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function emptyToNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

/** Klucz porównania nazw/kodów - wFirma i Turis różnią się interpunkcją i wielkością liter. */
function norm(s: unknown): string {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Jedna strona z retry na limicie API wFirma. null = wyczerpane próby (limit dalej trzyma). */
async function withRetry<T>(fetchPage: () => Promise<T>): Promise<T | null> {
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      return await fetchPage();
    } catch (err) {
      if (!(err instanceof WfirmaRateLimitError)) throw err;
      if (attempt === BACKOFF_MS.length) return null;
      await sleep(BACKOFF_MS[attempt]);
    }
  }
  return null;
}

/** Surowy towar wFirma -> wiersz wfirma_goods. Wspólne dla syncu z API i zasilania z pliku. */
export function toGoodRow(g: Record<string, unknown>) {
  return {
    id: Number(g.id),
    name: String(g.name ?? ""),
    code: emptyToNull(g.code),
    ean: emptyToNull(g.ean),
    raw: g,
    synced_at: new Date().toISOString(),
  };
}

/**
 * Surowy dokument przyjęcia -> wiersze wfirma_receipt_layers (po jednym na pozycję).
 * Pomija pozycje bez powiązanego towaru albo z nieliczbową ilością/ceną - nie niosą kosztu.
 */
export function toLayerRows(doc: Record<string, unknown>) {
  const rows: Record<string, unknown>[] = [];
  for (const c of unwrapDocContents(doc)) {
    const goodId = Number((c.good as { id?: unknown } | undefined)?.id ?? 0);
    const quantity = Number(c.count);
    const unitPrice = Number(c.price);
    if (!goodId || !Number.isFinite(quantity) || !Number.isFinite(unitPrice)) continue;
    rows.push({
      id: Number(c.id),
      good_id: goodId,
      doc_id: Number(doc.id),
      doc_number: String(doc.fullnumber ?? ""),
      doc_type: String(doc.type ?? ""),
      receipt_date: String(doc.date ?? ""),
      quantity,
      unit_price: unitPrice,
      raw: c,
      synced_at: new Date().toISOString(),
    });
  }
  return rows;
}

export async function syncGoods(): Promise<{ upserted: number; partial: boolean }> {
  const db = supabaseAdmin();
  let upserted = 0;

  for (let page = 1; ; page++) {
    const rows = await withRetry(() => findGoodsPage(page, PAGE_SIZE));
    if (rows === null) return { upserted, partial: true };
    if (rows.length === 0) break;

    const mapped = rows.map(toGoodRow);
    const { error } = await db.from("wfirma_goods").upsert(mapped);
    if (error) throw new Error(`upsert wfirma_goods (strona ${page}): ${error.message}`);
    upserted += mapped.length;

    if (rows.length < PAGE_SIZE) break;
  }
  return { upserted, partial: false };
}

/**
 * Przyjęcia PW i PZ wraz z pozycjami. Pobieramy WYŁĄCZNIE te dwa typy - pozostałe dokumenty
 * magazynowe (rezerwacje R, wydania WZ, RW, MM) nie niosą ceny zakupu, a jest ich ~50x więcej.
 */
export async function syncReceiptLayers(): Promise<{ docs: number; layers: number; partial: boolean }> {
  const db = supabaseAdmin();
  let docs = 0;
  const layers: Record<string, unknown>[] = [];

  for (const type of ["PW", "PZ"] as const) {
    for (let page = 1; ; page++) {
      const rows = await withRetry(() => findWarehouseDocsPage(type, page, PAGE_SIZE));
      if (rows === null) return { docs, layers: layers.length, partial: true };
      if (rows.length === 0) break;

      docs += rows.length;
      for (const doc of rows) layers.push(...toLayerRows(doc));
      if (rows.length < PAGE_SIZE) break;
    }
  }

  const { error } = await db.from("wfirma_receipt_layers").upsert(layers);
  if (error) throw new Error(`upsert wfirma_receipt_layers: ${error.message}`);
  return { docs, layers: layers.length, partial: false };
}

type ProductRow = { id: number; name: string | null; sku: string | null; ean: string | null };
type GoodRow = { id: number; name: string | null; code: string | null; ean: string | null };

/**
 * Mapowanie products (Turis) -> wfirma_goods, kaskadą kluczy od najpewniejszego:
 * EAN -> SKU/code -> znormalizowana nazwa. Zapisujemy też, którym kluczem trafiliśmy
 * (wfirma_match_key) - dopasowanie po nazwie jest realnie słabsze i trzeba je umieć wyodrębnić.
 */
export async function mapProductsToGoods(): Promise<{
  matched: number;
  unmatched: number;
  byKey: Record<string, number>;
}> {
  const db = supabaseAdmin();
  const products = await fetchAll<ProductRow>("products", "id, name, sku, ean");
  const goods = await fetchAll<GoodRow>("wfirma_goods", "id, name, code, ean");

  // Bez tego pusty katalog (np. po syncu przerwanym limitem API wFirma na pierwszej stronie)
  // przemapowałby WSZYSTKIE produkty na "niedopasowany", kasując poprawne mapowania
  // z poprzednich uruchomień. Brak danych ma zatrzymać mapowanie, a nie je wyczyścić.
  if (goods.length === 0) {
    throw new Error(
      "wfirma_goods jest puste - przerywam mapowanie, żeby nie skasować istniejących powiązań. " +
        "Najpierw zsynchronizuj towary (`npm run sync-costs`, gdy limit API wFirma puści)."
    );
  }

  const byEan = new Map<string, number>();
  const byCode = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const g of goods) {
    if (g.ean) byEan.set(String(g.ean).trim(), g.id);
    if (g.code) byCode.set(norm(g.code), g.id);
    if (g.name) byName.set(norm(g.name), g.id);
  }

  const byKey: Record<string, number> = { ean: 0, code: 0, name: 0 };
  const updates: { id: number; wfirma_good_id: number | null; wfirma_match_key: string | null }[] = [];
  let unmatched = 0;

  for (const p of products) {
    let goodId: number | undefined;
    let key: string | null = null;

    if (p.ean) {
      goodId = byEan.get(String(p.ean).trim());
      if (goodId) key = "ean";
    }
    if (!goodId && p.sku) {
      goodId = byCode.get(norm(p.sku));
      if (goodId) key = "code";
    }
    if (!goodId && p.name) {
      goodId = byName.get(norm(p.name));
      if (goodId) key = "name";
    }

    if (goodId && key) byKey[key]++;
    else unmatched++;

    updates.push({ id: p.id, wfirma_good_id: goodId ?? null, wfirma_match_key: key });
  }

  // upsert na products wymaga kompletu kolumn NOT NULL, więc idziemy update'ami w paczkach
  for (let i = 0; i < updates.length; i += 200) {
    const batch = updates.slice(i, i + 200);
    await Promise.all(
      batch.map((u) =>
        db
          .from("products")
          .update({ wfirma_good_id: u.wfirma_good_id, wfirma_match_key: u.wfirma_match_key })
          .eq("id", u.id)
      )
    );
  }

  return { matched: updates.length - unmatched, unmatched, byKey };
}

/**
 * Przepisuje koszt z warstw przyjęć na products.unit_cost i order_items.unit_cost_snapshot.
 * Metoda kosztu siedzi w widoku v_good_unit_cost (dziś: cena z pierwszego przyjęcia = metoda
 * EASI) - podmiana metody to podmiana TEGO widoku, bez zmian tutaj.
 */
export async function applyCosts(): Promise<{ productsUpdated: number; itemsUpdated: number }> {
  // Bezpośrednie połączenie do bazy, nie PostgREST: przepisanie kosztu dotyka ~90 tys. pozycji
  // zamówień i przekracza statement_timeout nałożony na role API (potwierdzone - rpc kończyło się
  // "canceling statement due to statement timeout"). To operacja masowa, uruchamiana ze skryptu,
  // więc stać nas na podniesienie limitu na czas jej trwania.
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error("Brak SUPABASE_DB_URL w .env.local - potrzebny do masowego przeliczenia kosztów");
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query("set statement_timeout = '10min'");
    const { rows } = await client.query<{ products_updated: string; items_updated: string }>(
      "select * from apply_product_costs()"
    );
    return {
      productsUpdated: Number(rows[0]?.products_updated ?? 0),
      itemsUpdated: Number(rows[0]?.items_updated ?? 0),
    };
  } finally {
    await client.end();
  }
}
