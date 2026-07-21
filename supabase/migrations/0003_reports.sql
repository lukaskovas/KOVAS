-- Widoki pod UI: raport zamówień i raport sprzedaży produktów (odpowiedniki EASI
-- reports_orders_sale i reports_products_sale). Ciężka robota (JOIN-y, agregacja CoGS)
-- w SQL zamiast w JS - prościej, szybciej, spójnie z resztą kolumn.

-- ============================================================
-- v_orders_report - jeden wiersz na zamówienie, wzbogacony o dane faktury i CoGS/marżę.
-- Zamówienie z >1 dowiązaną fakturą (match_status='ambiguous') pokazuje NAJNOWIEJ dopasowaną -
-- pełna historia zostaje w order_invoice_links, tu tylko jeden reprezentatywny wiersz na order.
-- ============================================================
create view v_orders_report as
select
  o.id,
  o.display_order_number,
  o.company_name,
  o.status,
  o.current_status_name,
  o.currency_code,
  o.grand_total_price,
  o.vat_price,
  o.discount_price,
  o.shipping_price,
  o.sub_total_price_without_vat,
  o.is_paid,
  o.agent,
  o.turis_created_at,
  li.fullnumber as invoice_fullnumber,
  li.match_status as invoice_match_status,
  li.currency_exchange as invoice_currency_exchange,
  li.currency_label as invoice_currency_label,
  coalesce(oi.cogs_total, 0) as cogs_total,
  o.sub_total_price_without_vat - coalesce(oi.cogs_total, 0) as margin
from orders o
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
-- v_order_items_report - jeden wiersz na pozycję zamówienia (sprzedaż produktów).
-- ============================================================
create view v_order_items_report as
select
  oi.id,
  oi.order_id,
  o.display_order_number,
  o.company_name,
  o.turis_created_at,
  oi.name as product_name,
  oi.sku,
  p.ean,
  p.brand_id,
  oi.quantity,
  oi.price,
  oi.discount,
  oi.total_price,
  oi.final_price,
  o.currency_code,
  o.vat_rate,
  oi.unit_cost_snapshot as cogs
from order_items oi
join orders o on o.id = oi.order_id
left join products p on p.id = oi.product_id;
