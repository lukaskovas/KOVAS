-- Wzbogacenie widoków raportowych do parytetu kolumn z EASI (patrz docs/analiza-easi/LUKI-DANYCH.md).
-- Dokładane kolumny: dane kontrahenta (NIP, kraje), VAT %, terminy i sposób płatności,
-- transport brutto, ceny netto/brutto na poziomie pozycji.
--
-- Świadomie NIE dokładamy: CoGS (brak danych w Turis - 100% pozycji bez kosztu),
-- Handlowiec i Typ kontrahenta (brak w Turis), przeliczenia PLN/EUR (czeka na decyzję
-- o kursie bieżącym vs historycznym). Te kolumny wymagają najpierw ustaleń biznesowych.

drop view if exists v_orders_report;
drop view if exists v_order_items_report;

-- ============================================================
-- v_orders_report
-- ============================================================
create view v_orders_report as
select
  o.id,
  o.display_order_number,
  o.company_name,
  c.vat_number,
  c.country_iso_code            as country_code,
  c.country                     as country_name,
  o.status,
  o.current_status_name,
  o.currency_code,
  o.grand_total_price,
  o.vat_price,
  o.vat_rate,
  o.discount_price,
  o.shipping_price,
  -- transport brutto: Turis podaje tylko netto, VAT liczymy stawką zamówienia
  round(o.shipping_price * (1 + coalesce(o.vat_rate, 0) / 100.0), 2) as shipping_price_gross,
  o.sub_total_price_without_vat,
  o.is_paid,
  o.agent,
  o.turis_created_at,
  -- Turis trzyma payment_terms jako liczbę dni; brak wartości = płatność przy odbiorze
  coalesce((o.raw ->> 'payment_terms')::numeric, 0)                  as payment_terms_days,
  (o.turis_created_at::date + coalesce((o.raw ->> 'payment_terms')::numeric, 0)::int) as payment_due_date,
  case when coalesce((o.raw ->> 'payment_terms')::numeric, 0) > 0
       then 'transfer' else 'cod' end                                as payment_method,
  li.fullnumber                 as invoice_fullnumber,
  li.match_status               as invoice_match_status,
  li.currency_exchange          as invoice_currency_exchange,
  li.currency_label             as invoice_currency_label,
  coalesce(oi.cogs_total, 0)    as cogs_total,
  o.sub_total_price_without_vat - coalesce(oi.cogs_total, 0) as margin
from orders o
left join companies c on c.id = o.company_id
left join lateral (
  select i.fullnumber, i.match_status, i.currency_exchange, i.currency_label
  from order_invoice_links l
  join invoices i on i.id = l.invoice_id
  where l.order_id = o.id
  order by l.matched_at desc nulls last
  limit 1
) li on true
left join (
  select order_id, sum(unit_cost_snapshot) as cogs_total
  from order_items
  group by order_id
) oi on oi.order_id = o.id;

-- ============================================================
-- v_order_items_report
-- Ceny: Turis podaje NETTO (potwierdzone: order_items.price = kolumna "netto po rabacie" w EASI).
-- Brutto liczymy netto * (1 + VAT). UWAGA: EASI liczy tu brutto jako netto * 1,23 * 1,23
-- (podwójny VAT) - to błąd EASI, którego celowo nie powielamy. Szczegóły w LUKI-DANYCH.md sekcja 4b.
-- ============================================================
create view v_order_items_report as
select
  oi.id,
  oi.order_id,
  o.display_order_number,
  o.company_name,
  c.vat_number,
  c.country_iso_code            as country_code,
  c.country                     as country_name,
  o.turis_created_at,
  (o.turis_created_at::date + coalesce((o.raw ->> 'payment_terms')::numeric, 0)::int) as payment_due_date,
  oi.name                       as product_name,
  oi.sku,
  p.ean,
  p.brand_id,
  oi.quantity,
  oi.price                      as unit_price_net,
  round(oi.price * (1 + coalesce(o.vat_rate, 0) / 100.0), 2)         as unit_price_gross,
  oi.discount,
  oi.total_price                as total_price_net,
  round(oi.total_price * (1 + coalesce(o.vat_rate, 0) / 100.0), 2)   as total_price_gross,
  round(oi.price * coalesce(o.vat_rate, 0) / 100.0, 2)               as vat_amount_per_unit,
  oi.final_price,
  o.currency_code,
  o.vat_rate,
  oi.unit_cost_snapshot         as cogs
from order_items oi
join orders o on o.id = oi.order_id
left join companies c on c.id = o.company_id
left join products p on p.id = oi.product_id;
