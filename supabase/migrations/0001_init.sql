-- Kovas: schemat replikujący dane z Turis i wFirma pod raportowanie (etap 1).
-- Klucze główne = naturalne ID ze źródła (Turis/wFirma). Kolumna `raw jsonb` na każdej
-- tabeli źródłowej trzyma pełny payload - nic nie tracimy z pól, których dziś nie mapujemy jawnie.

-- ============================================================
-- companies (kontrahenci Turis)
-- ============================================================
create table companies (
  id                 bigint primary key,              -- Turis company.id
  name               text not null,
  vat_number         text,
  email              text,
  phone_number       text,
  address            text,
  city               text,
  zip_code           text,
  country            text,
  country_iso_code   text,
  discount           numeric,
  credit_limit       numeric,
  currency_id        integer,
  raw                jsonb not null,
  first_seen_at      timestamptz not null default now(),
  synced_at          timestamptz not null default now()
);
create index companies_name_idx on companies using gin (to_tsvector('simple', coalesce(name, '')));
create index companies_vat_idx on companies (vat_number);

-- ============================================================
-- products (Turis - źródło CoGS)
-- ============================================================
create table products (
  id                 bigint primary key,              -- Turis product.id
  name               text not null,
  sku                text,
  ean                text,
  brand_id           integer,
  unit_cost          numeric,                          -- źródło CoGS
  stock              numeric,
  raw                jsonb not null,
  first_seen_at      timestamptz not null default now(),
  synced_at          timestamptz not null default now()
);
create index products_sku_idx on products (sku);
create index products_ean_idx on products (ean);

-- ============================================================
-- orders (Turis)
-- ============================================================
create table orders (
  id                          bigint primary key,      -- Turis order.id
  display_order_number        text not null,            -- klucz do parsowania opisu faktury wFirma
  company_id                  bigint references companies(id),
  company_name                text,                     -- snapshot na czas zamówienia
  status                      text,
  current_status_id           integer,
  current_status_name         text,
  currency_code                text,
  currency_symbol               text,
  currency_id                   integer,
  -- pola z Turis `summary` - już policzone przez Turis, NIE przeliczamy:
  items_total_price             numeric,
  discount                      numeric,
  discount_price                 numeric,
  shipping_price                  numeric,
  sub_total_price                  numeric,
  sub_total_price_without_vat       numeric,
  vat_rate                          numeric,
  vat_price                          numeric,
  grand_total_price                   numeric,
  fee_price                            numeric,
  is_paid                               boolean,
  agent                                  text,          -- handlowiec
  external_reference                    text,
  turis_invoice_id                       bigint,         -- pole istnieje w Turis, ale EMPIRYCZNIE zawsze null -
                                                          -- zapisujemy dla przejrzystości/audytu, NIE polegamy na nim
  turis_created_at                        timestamptz,
  turis_updated_at                         timestamptz,
  raw                                       jsonb not null, -- pełny order (bez `items` - patrz order_items)
  first_seen_at                             timestamptz not null default now(),
  synced_at                                  timestamptz not null default now()
);
create unique index orders_display_number_idx on orders (display_order_number);
create index orders_company_idx on orders (company_id);
create index orders_updated_idx on orders (turis_updated_at);
create index orders_status_idx on orders (current_status_name);

-- ============================================================
-- order_items (pozycje zamówień Turis, spłaszczone z zagnieżdżonych grup)
-- ============================================================
create table order_items (
  id                     bigint primary key,           -- Turis line-item id (order.items[].items[].id)
  order_id               bigint not null references orders(id) on delete cascade,
  product_id              bigint references products(id),  -- nullable: produkt mógł zniknąć z Turis
  group_name               text,
  name                       text,                          -- snapshot nazwy produktu
  sku                         text,                          -- snapshot SKU
  quantity                     numeric not null,
  price                          numeric,
  discount                        numeric,
  total_price                      numeric,
  final_price                       numeric,
  stock_location_name                 text,
  unit_cost_snapshot                    numeric,             -- CoGS "zamrożony" w momencie syncu (patrz README ryzyka)
  raw                                     jsonb not null,
  synced_at                                timestamptz not null default now()
);
create index order_items_order_idx on order_items (order_id);
create index order_items_product_idx on order_items (product_id);

-- ============================================================
-- invoices (wFirma)
-- ============================================================
create table invoices (
  id                     bigint primary key,           -- wFirma invoice.id
  fullnumber              text,                         -- np. FV/KOV/S/282/7/2026
  description               text,                        -- np. "Order: 11093" - jedyny dziś klucz łączący
  parsed_order_number         text,                        -- wynik regexu z description, do audytu
  invoice_type                  text,                       -- normal / korekta / proforma itd.
  invoice_date                    date,
  paymentstate                      text,
  total                                numeric,
  currency                              text,
  currency_exchange                       numeric,          -- read-only z wFirma, kurs zastosowany przy fakturze
  currency_label                           text,
  currency_date                              date,
  contractor_name                              text,        -- snapshot
  match_status                                   text not null default 'pending'
    check (match_status in ('pending', 'matched', 'ambiguous', 'unmatched_no_order', 'unparseable')),
  raw                                              jsonb not null,
  first_seen_at                                     timestamptz not null default now(),
  synced_at                                          timestamptz not null default now()
);
create index invoices_parsed_number_idx on invoices (parsed_order_number);
create index invoices_match_status_idx on invoices (match_status);
create index invoices_date_idx on invoices (invoice_date);

-- ============================================================
-- order_invoice_links (dowiązanie zamówienia z fakturą, wynik matchera)
-- ============================================================
create table order_invoice_links (
  id                     bigserial primary key,
  order_id                bigint not null references orders(id),
  invoice_id               bigint not null references invoices(id),
  match_method               text not null default 'description_regex'
    check (match_method in ('description_regex', 'manual', 'turis_invoice_id')),
  matched_order_number         text not null,             -- co dokładnie wyciągnięto z description
  amount_matches                 boolean,                  -- czy grand_total_price (Turis) ~= total (wFirma)
  amount_diff                      numeric,
  confidence                         text not null default 'high' check (confidence in ('high', 'low')),
  matched_at                           timestamptz not null default now(),
  unique (order_id, invoice_id)
);
create index oil_order_idx on order_invoice_links (order_id);
create index oil_invoice_idx on order_invoice_links (invoice_id);

-- ============================================================
-- sync_log (obserwowalność każdego przebiegu synchronizacji)
-- ============================================================
create table sync_log (
  id                  bigserial primary key,
  source                text not null,          -- 'turis_companies' | 'turis_products' | 'turis_orders_backfill' |
                                                  -- 'turis_orders_delta' | 'turis_orders_webhook' |
                                                  -- 'wfirma_invoices' | 'order_invoice_matcher'
  run_type               text not null check (run_type in ('cron', 'webhook', 'manual', 'backfill')),
  started_at               timestamptz not null default now(),
  finished_at                timestamptz,
  status                       text not null default 'running'
    check (status in ('running', 'success', 'partial', 'failed')),
  records_seen                  integer default 0,
  records_upserted                integer default 0,
  records_failed                    integer default 0,
  cursor_from                         text,                 -- np. ISO data (Turis delta) albo Invoice.id (wFirma) - jako tekst, źródła się różnią typem
  cursor_to                             text,
  error_message                           text,
  error_detail                              jsonb           -- np. treść odpowiedzi TOTAL REQUESTS LIMIT EXCEEDED
);
create index sync_log_source_idx on sync_log (source, started_at desc);

-- ============================================================
-- webhook_events (bufor/log webhooków Turis - idempotencja i diagnostyka; krok 6, na przyszłość)
-- ============================================================
create table webhook_events (
  id                  bigserial primary key,
  subscription_id       text,
  event                   text not null,        -- np. 'order.updated'
  resource_id               bigint not null,
  state_token                 text,              -- do weryfikacji nadawcy
  received_at                   timestamptz not null default now(),
  processed_at                    timestamptz,
  status                            text not null default 'pending'
    check (status in ('pending', 'processed', 'failed')),
  error_message                       text
);
create index webhook_events_pending_idx on webhook_events (status, received_at) where status = 'pending';

-- ============================================================
-- Widoki diagnostyczne ("dziury w danych" - cel biznesowy klienta)
-- ============================================================
create view v_order_invoice_coverage as
select
  o.id, o.display_order_number, o.grand_total_price, o.turis_created_at,
  l.invoice_id, i.fullnumber, i.match_status,
  case when l.id is null then 'brak_faktury' else 'ma_fakture' end as coverage
from orders o
left join order_invoice_links l on l.order_id = o.id
left join invoices i on i.id = l.invoice_id;

create view v_invoice_match_quality as
select match_status, count(*) as n, min(invoice_date) as od, max(invoice_date) as do
from invoices
group by match_status;

create view v_sync_health as
select distinct on (source) source, status, started_at, finished_at, records_upserted, records_failed, error_message
from sync_log
order by source, started_at desc;

-- ============================================================
-- RLS: tabele czytane/pisane WYŁĄCZNIE server-side (service role)
-- ============================================================
alter table companies enable row level security;
alter table products enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table invoices enable row level security;
alter table order_invoice_links enable row level security;
alter table sync_log enable row level security;
alter table webhook_events enable row level security;
-- Świadomie ZERO policy dla anon/authenticated - dostęp tylko przez
-- SUPABASE_SERVICE_ROLE_KEY w server components/API routes (ten klucz
-- omija RLS), analogicznie do wzorca "server-only" w lib/turis.ts i lib/wfirma.ts.
