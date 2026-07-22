-- Dodaje do raportu zamówień dwie kolumny "Suma produktów" = wartość zamówienia bez transportu.
-- Na realnych danych zweryfikowano, że oba pola sumy z Turis ZAWIERAJĄ już transport:
--   sub_total_price_without_vat = produkty - rabat + transport netto
--   grand_total_price           = sub_total_price_without_vat + VAT
-- Dlatego czysta wartość produktów (po rabacie) = suma - transport:
--   products_net   = sub_total_price_without_vat - transport netto
--   products_gross = grand_total_price           - transport brutto
-- coalesce(shipping,0): zamówienia bez transportu mają shipping_price NULL - bez tego cała
-- kolumna produktów byłaby NULL, a powinna pokazać pełną wartość zamówienia.
--
-- Zmieniamy definicję v_orders_report, więc trzeba najpierw zdjąć zależną migawkę
-- mv_report_orders, a po zmianie widoku odtworzyć ją 1:1 z migracji 0011 (select v.* przenosi
-- nowe kolumny automatycznie).

drop materialized view if exists mv_report_orders;
drop view if exists v_orders_report;

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
  round(o.shipping_price * (1 + coalesce(o.vat_rate, 0) / 100.0), 2) as shipping_price_gross,
  o.sub_total_price_without_vat,
  -- Suma produktów = wartość zamówienia bez transportu (patrz nagłówek migracji)
  o.sub_total_price_without_vat - coalesce(o.shipping_price, 0)      as products_net,
  round(o.grand_total_price
        - round(coalesce(o.shipping_price, 0) * (1 + coalesce(o.vat_rate, 0) / 100.0), 2), 2) as products_gross,
  o.is_paid,
  o.agent,
  o.turis_created_at,
  coalesce((o.raw ->> 'payment_terms')::numeric, 0)                  as payment_terms_days,
  (o.turis_created_at::date + coalesce((o.raw ->> 'payment_terms')::numeric, 0)::int) as payment_due_date,
  case when coalesce((o.raw ->> 'payment_terms')::numeric, 0) > 0
       then 'transfer' else 'cod' end                                as payment_method,
  li.fullnumber                 as invoice_fullnumber,
  li.match_status               as invoice_match_status,
  li.currency_exchange          as invoice_currency_exchange,
  li.currency_label             as invoice_currency_label,
  coalesce(oi.cogs_total, 0)    as cogs_total,
  o.sub_total_price_without_vat - coalesce(oi.cogs_total, 0) as margin,

  -- Kursy zastosowane do przeliczeń. Zamówienie w PLN ma kurs na PLN = 1 i pokazuje kurs EUR/PLN
  -- (tak jak EASI), zamówienie w EUR odwrotnie.
  case when o.currency_code = 'PLN' then 1 else fx_cur.mid end       as rate_pln,
  case when o.currency_code = 'EUR' then 1 else fx_eur.mid end       as rate_eur,
  coalesce(fx_cur.table_no, fx_eur.table_no)                         as rate_table_no,
  coalesce(fx_cur.effective_date, fx_eur.effective_date)             as rate_date,

  -- Wartości w PLN: kwota w walucie zamówienia * kurs tej waluty
  round(o.sub_total_price_without_vat * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2) as net_pln,
  round(o.grand_total_price           * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2) as gross_pln,
  round(o.discount_price              * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2) as discount_pln,
  round(o.vat_price                   * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2) as vat_pln,

  -- Wartości w EUR: przez PLN, czyli (kwota * kurs waluty) / kurs EUR
  round(o.sub_total_price_without_vat * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end / nullif(fx_eur.mid, 0), 2) as net_eur,
  round(o.grand_total_price           * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end / nullif(fx_eur.mid, 0), 2) as gross_eur,
  round(o.discount_price              * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end / nullif(fx_eur.mid, 0), 2) as discount_eur,
  round(o.vat_price                   * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end / nullif(fx_eur.mid, 0), 2) as vat_eur
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
) oi on oi.order_id = o.id
-- kurs waluty zamówienia z ostatniego notowania PRZED datą zamówienia
left join lateral (
  select f.mid, f.table_no, f.effective_date
  from fx_rates f
  where f.currency = o.currency_code and f.effective_date < o.turis_created_at::date
  order by f.effective_date desc
  limit 1
) fx_cur on o.currency_code <> 'PLN'
-- kurs EUR/PLN z tego samego dnia - potrzebny, by wyrazić wartości w EUR
left join lateral (
  select f.mid, f.table_no, f.effective_date
  from fx_rates f
  where f.currency = 'EUR' and f.effective_date < o.turis_created_at::date
  order by f.effective_date desc
  limit 1
) fx_eur on true;

-- Migawka odtworzona 1:1 z migracji 0011 - select v.* przenosi products_net/products_gross.
create materialized view mv_report_orders as
select
  v.*,
  ord.company_id,
  comp.name              as company_current_name,
  comp.agent             as sales_agent,
  comp.contractor_type   as contractor_type,
  coalesce(it.qty, 0)    as qty
from v_orders_report v
join orders ord on ord.id = v.id
left join companies comp on comp.id = ord.company_id
left join (select oi.order_id, sum(oi.quantity) as qty from order_items oi group by 1) it
       on it.order_id = v.id;

create unique index mv_report_orders_pkey on mv_report_orders (id);
create index mv_report_orders_date_idx    on mv_report_orders (turis_created_at);
create index mv_report_orders_company_idx on mv_report_orders (company_id);
create index mv_report_orders_default_sort_idx on mv_report_orders (turis_created_at desc, id);
create index mv_report_orders_status_idx   on mv_report_orders (current_status_name);
create index mv_report_orders_currency_idx on mv_report_orders (currency_code);
create index mv_report_orders_match_idx    on mv_report_orders (invoice_match_status);
create index mv_report_orders_agent_idx    on mv_report_orders (sales_agent);

grant select on mv_report_orders to service_role;
