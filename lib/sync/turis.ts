import "server-only";
import { turisGet } from "@/lib/turis";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Sync Turis -> Supabase (companies, products, orders + order_items).
 * Kolejność ma znaczenie: companies i products MUSZĄ być zsynchronizowane przed orders
 * (foreign key orders.company_id -> companies.id, order_items.product_id -> products.id).
 */

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function logSync(source: string, fn: () => Promise<{ seen: number; upserted: number; failed: number }>) {
  const db = supabaseAdmin();
  const { data: logRow } = await db
    .from("sync_log")
    .insert({ source, run_type: "backfill", status: "running" })
    .select("id")
    .single();
  try {
    const result = await fn();
    await db
      .from("sync_log")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        records_seen: result.seen,
        records_upserted: result.upserted,
        records_failed: result.failed,
      })
      .eq("id", logRow?.id);
    return result;
  } catch (err) {
    await db
      .from("sync_log")
      .update({ finished_at: new Date().toISOString(), status: "failed", error_message: String(err) })
      .eq("id", logRow?.id);
    throw err;
  }
}

/* ---- Companies ---- */

type RawCompany = {
  id: number;
  name: string;
  vat_number: string | null;
  email: string | null;
  phone_number: string | null;
  address: string | null;
  city: string | null;
  zip_code: string | null;
  country: string | null;
  country_iso_code: string | null;
  discount: number | string | null;
  credit_limit: number | string | null;
  currency_id: number | null;
};

export async function syncCompanies(): Promise<{ upserted: number; validIds: Set<number> }> {
  const validIds = new Set<number>();
  const { upserted } = await logSync("turis_companies", async () => {
    const { data } = await turisGet<RawCompany>("companies");
    const rows = data.map((c) => {
      validIds.add(c.id);
      return {
        id: c.id,
        name: c.name,
        vat_number: c.vat_number,
        email: c.email,
        phone_number: c.phone_number,
        address: c.address,
        city: c.city,
        zip_code: c.zip_code,
        country: c.country,
        country_iso_code: c.country_iso_code,
        discount: c.discount,
        credit_limit: c.credit_limit,
        currency_id: c.currency_id,
        raw: c,
        synced_at: new Date().toISOString(),
      };
    });
    let upserted = 0;
    for (const batch of chunk(rows, 500)) {
      const { error } = await supabaseAdmin().from("companies").upsert(batch);
      if (error) throw new Error(`upsert companies: ${error.message}`);
      upserted += batch.length;
    }
    return { seen: rows.length, upserted, failed: 0 };
  });
  return { upserted, validIds };
}

/* ---- Products ---- */

type RawProduct = {
  id: number;
  name: string;
  sku: string | null;
  ean: string | null;
  brand_id: number | null;
  unit_cost: number | string | null;
  stock: number | string | null;
};

export type ProductIndex = { unitCost: Map<number, number>; validIds: Set<number> };

export async function syncProducts(): Promise<ProductIndex> {
  const unitCost = new Map<number, number>();
  const validIds = new Set<number>();
  await logSync("turis_products", async () => {
    const { data } = await turisGet<RawProduct>("products");
    const rows = data.map((p) => {
      const cost = p.unit_cost === null || p.unit_cost === undefined ? null : Number(p.unit_cost);
      validIds.add(p.id);
      if (cost !== null && !Number.isNaN(cost)) unitCost.set(p.id, cost);
      return {
        id: p.id,
        name: p.name,
        sku: p.sku,
        ean: p.ean,
        brand_id: p.brand_id,
        unit_cost: p.unit_cost,
        stock: p.stock,
        raw: p,
        synced_at: new Date().toISOString(),
      };
    });
    let upserted = 0;
    for (const batch of chunk(rows, 500)) {
      const { error } = await supabaseAdmin().from("products").upsert(batch);
      if (error) throw new Error(`upsert products: ${error.message}`);
      upserted += batch.length;
    }
    return { seen: rows.length, upserted, failed: 0 };
  });
  return { unitCost, validIds };
}

/* ---- Brands ---- */

type RawBrand = { id: number; name: string };

/**
 * Marki z Turis (/brands) -> tabela brands. products.brand_id to samo ID, ale bez nazwy;
 * bez tej tabeli brand w raporcie dostaw byłby gołym numerem. Marek jest kilkadziesiąt - jedna strona.
 */
export async function syncBrands(): Promise<{ upserted: number }> {
  const { upserted } = await logSync("turis_brands", async () => {
    const { data } = await turisGet<RawBrand>("brands");
    const rows = data.map((b) => ({
      id: b.id,
      name: b.name,
      raw: b,
      synced_at: new Date().toISOString(),
    }));
    let upserted = 0;
    for (const batch of chunk(rows, 500)) {
      const { error } = await supabaseAdmin().from("brands").upsert(batch);
      if (error) throw new Error(`upsert brands: ${error.message}`);
      upserted += batch.length;
    }
    return { seen: rows.length, upserted, failed: 0 };
  });
  return { upserted };
}

/* ---- Orders + order_items ---- */

type RawOrderItem = {
  id: number;
  product_id: number | null;
  name: string;
  price: number | string | null;
  quantity: number | string;
  discount?: { discount: number; amount: number; type: string } | null;
  total_price: number | string | null;
  final_price: number | string | null;
  stock_location_name: string | null;
  product?: { id: number; sku: string | null } | null;
};

type RawOrderItemGroup = { group_name: string | null; items: RawOrderItem[] };

type RawOrderSummary = {
  items_total_price: number;
  discount: number;
  discount_price: number;
  shipping_price: number;
  sub_total_price: number;
  sub_total_price_without_vat: number;
  vat_rate: number;
  vat_price: number;
  grand_total_price: number;
  fee_price: number;
};

type RawOrder = {
  id: number;
  display_order_number: string;
  status: string | null;
  current_status: { id: number; name: string } | null;
  company_id: number | null;
  company_name: string | null;
  currency: { code: string; symbol: string; id: number } | null;
  summary: RawOrderSummary | null;
  is_paid: boolean | null;
  agent: string | null;
  external_reference: string | null;
  invoice_id: number | null;
  created_at: string | null;
  updated_at: string | null;
  items: RawOrderItemGroup[];
};

function mapOrder(o: RawOrder, validCompanyIds: Set<number>) {
  const s = o.summary;
  // firma mogła zniknąć z Turisa (zmieniony/usunięty kontrahent) - snapshot nazwy zostaje,
  // ale FK zerujemy, żeby nie naruszyć referencyjnej integralności (ten sam wzorzec co product_id niżej)
  const companyId = o.company_id !== null && validCompanyIds.has(o.company_id) ? o.company_id : null;
  return {
    id: o.id,
    display_order_number: o.display_order_number,
    company_id: companyId,
    company_name: o.company_name,
    status: o.status,
    current_status_id: o.current_status?.id ?? null,
    current_status_name: o.current_status?.name ?? null,
    currency_code: o.currency?.code ?? null,
    currency_symbol: o.currency?.symbol ?? null,
    currency_id: o.currency?.id ?? null,
    items_total_price: s?.items_total_price ?? null,
    discount: s?.discount ?? null,
    discount_price: s?.discount_price ?? null,
    shipping_price: s?.shipping_price ?? null,
    sub_total_price: s?.sub_total_price ?? null,
    sub_total_price_without_vat: s?.sub_total_price_without_vat ?? null,
    vat_rate: s?.vat_rate ?? null,
    vat_price: s?.vat_price ?? null,
    grand_total_price: s?.grand_total_price ?? null,
    fee_price: s?.fee_price ?? null,
    is_paid: o.is_paid,
    agent: o.agent,
    external_reference: o.external_reference,
    turis_invoice_id: o.invoice_id,
    turis_created_at: o.created_at,
    turis_updated_at: o.updated_at,
    raw: { ...o, items: undefined }, // items trzymamy osobno w order_items, nie duplikujemy
    synced_at: new Date().toISOString(),
  };
}

function mapOrderItems(o: RawOrder, validProductIds: Set<number>, unitCost: Map<number, number>) {
  const rows: Record<string, unknown>[] = [];
  for (const group of o.items ?? []) {
    for (const item of group.items ?? []) {
      const productId = item.product_id !== null && validProductIds.has(item.product_id) ? item.product_id : null;
      const qty = Number(item.quantity) || 0;
      const cost = productId !== null ? unitCost.get(productId) : undefined;
      rows.push({
        id: item.id,
        order_id: o.id,
        product_id: productId,
        group_name: group.group_name,
        name: item.name,
        sku: item.product?.sku ?? null,
        quantity: item.quantity,
        price: item.price,
        discount: item.discount?.amount ?? null,
        total_price: item.total_price,
        final_price: item.final_price,
        stock_location_name: item.stock_location_name,
        unit_cost_snapshot: cost !== undefined ? cost * qty : null,
        raw: item,
        synced_at: new Date().toISOString(),
      });
    }
  }
  return rows;
}

/** Synchronizuje WSZYSTKIE strony zamówień (backfill). Wywołać po syncCompanies()/syncProducts(). */
export async function syncAllOrders(
  productIndex: ProductIndex,
  validCompanyIds: Set<number>,
  onProgress?: (page: number, lastPage: number) => void
) {
  return logSync("turis_orders_backfill", async () => {
    let seen = 0;
    let upserted = 0;
    let page = 1;
    let lastPage = 1;
    do {
      const { data, meta } = await turisGet<RawOrder>("orders", { page });
      lastPage = meta?.last_page ?? page;
      seen += data.length;

      const orderRows = data.map((o) => mapOrder(o, validCompanyIds));
      const itemRows = data.flatMap((o) => mapOrderItems(o, productIndex.validIds, productIndex.unitCost));

      // najpierw orders (FK dla order_items), potem order_items
      const { error: orderErr } = await supabaseAdmin().from("orders").upsert(orderRows);
      if (orderErr) throw new Error(`upsert orders (strona ${page}): ${orderErr.message}`);
      if (itemRows.length) {
        const { error: itemErr } = await supabaseAdmin().from("order_items").upsert(itemRows, { onConflict: "id" });
        if (itemErr) throw new Error(`upsert order_items (strona ${page}): ${itemErr.message}`);
      }
      upserted += orderRows.length;
      onProgress?.(page, lastPage);
      page++;
    } while (page <= lastPage);
    return { seen, upserted, failed: 0 };
  });
}

// 1h nakładki na okno delty - upsert po id jest idempotentny, więc powtórne pobranie tych samych
// rekordów nie szkodzi, a bufor chroni przed zgubieniem zmiany na granicy poprzedniego okna
// (różnice zegarów, opóźnienia po stronie Turis).
const DELTA_BUFFER_SEC = 60 * 60;

/**
 * Sync PRZYROSTOWY zamówień - tylko zmienione od ostatniego udanego przebiegu.
 * Endpoint orders/updated/<from>/<to>; znaczniki to unix w sekundach (API waliduje: liczba 1-10 cyfr).
 * Do uruchamiania z crona (co 15 min) - w przeciwieństwie do syncAllOrders nie przechodzi ~700 stron,
 * więc mieści się w limicie funkcji serverless. Wołać po syncCompanies()/syncProducts().
 */
export async function syncOrdersDelta(
  productIndex: ProductIndex,
  validCompanyIds: Set<number>,
  runType: "cron" | "manual" = "cron"
) {
  const db = supabaseAdmin();
  const nowSec = Math.floor(Date.now() / 1000);

  // Watermark = początek ostatniego udanego synca zamówień (backfill lub delta) minus bufor.
  // Bezpieczne czasowo: oba znaczniki (from i to) biorę z naszego zegara, nie z pól Turis,
  // więc strefa czasowa API nie ma znaczenia. Bez historii - ostatnia doba.
  const { data: last } = await db
    .from("sync_log")
    .select("started_at")
    .in("source", ["turis_orders_backfill", "turis_orders_delta"])
    .eq("status", "success")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fromSec = last?.started_at
    ? Math.floor(new Date(last.started_at).getTime() / 1000) - DELTA_BUFFER_SEC
    : nowSec - 24 * 3600;

  const { data: logRow } = await db
    .from("sync_log")
    .insert({
      source: "turis_orders_delta",
      run_type: runType,
      status: "running",
      cursor_from: String(fromSec),
      cursor_to: String(nowSec),
    })
    .select("id")
    .single();

  try {
    let seen = 0;
    let upserted = 0;
    let page = 1;
    let lastPage = 1;
    do {
      const { data, meta } = await turisGet<RawOrder>(`orders/updated/${fromSec}/${nowSec}`, { page });
      lastPage = meta?.last_page ?? page;
      seen += data.length;

      const orderRows = data.map((o) => mapOrder(o, validCompanyIds));
      const itemRows = data.flatMap((o) => mapOrderItems(o, productIndex.validIds, productIndex.unitCost));

      if (orderRows.length) {
        const { error: orderErr } = await db.from("orders").upsert(orderRows);
        if (orderErr) throw new Error(`upsert orders delta (strona ${page}): ${orderErr.message}`);
      }
      if (itemRows.length) {
        const { error: itemErr } = await db.from("order_items").upsert(itemRows, { onConflict: "id" });
        if (itemErr) throw new Error(`upsert order_items delta (strona ${page}): ${itemErr.message}`);
      }
      upserted += orderRows.length;
      page++;
    } while (page <= lastPage);

    await db
      .from("sync_log")
      .update({
        finished_at: new Date().toISOString(),
        status: "success",
        records_seen: seen,
        records_upserted: upserted,
        records_failed: 0,
      })
      .eq("id", logRow?.id);
    return { seen, upserted, fromSec, toSec: nowSec };
  } catch (err) {
    await db
      .from("sync_log")
      .update({ finished_at: new Date().toISOString(), status: "failed", error_message: String(err) })
      .eq("id", logRow?.id);
    throw err;
  }
}
