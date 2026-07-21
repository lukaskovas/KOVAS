-- Kursy walut NBP (tabela A) + przeliczenia wartości zamówień na PLN i EUR.
--
-- Reguła uzgodniona z Kovas: kurs z dnia POPRZEDZAJĄCEGO zamówienie, ze źródła oficjalnego (NBP).
-- NBP nie notuje w weekendy i święta, więc "dzień poprzedzający" oznacza w praktyce
-- OSTATNIE NOTOWANIE ŚCIŚLE PRZED datą zamówienia (dla poniedziałku będzie to piątek).
--
-- Uwaga na różnicę wobec EASI: EASI stosuje jeden bieżący kurs dla całego raportu, przez co
-- historyczne kwoty zmieniają się z dnia na dzień. Tutaj kurs jest przypięty do daty zamówienia,
-- więc raport sprzed miesiąca policzy się identycznie dziś i za rok.

create table fx_rates (
  currency        text not null,
  effective_date  date not null,
  mid             numeric not null,     -- kurs średni NBP, ile PLN za 1 jednostkę waluty
  table_no        text,                 -- np. "137/A/NBP/2026" - do audytu, którą tabelę zastosowano
  fetched_at      timestamptz not null default now(),
  primary key (currency, effective_date)
);
-- indeks pod zapytanie "ostatnie notowanie przed datą" (skan wstecz po dacie)
create index fx_rates_lookup_idx on fx_rates (currency, effective_date desc);

alter table fx_rates enable row level security;
grant select, insert, update, delete on fx_rates to service_role;

-- ============================================================
-- v_orders_report - dokładamy kursy i wartości w PLN oraz EUR (kolumny 21-30 raportu EASI)
-- ============================================================
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
  fx_cur.table_no                                                    as rate_table_no,
  fx_cur.effective_date                                              as rate_date,

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
  select f.mid
  from fx_rates f
  where f.currency = 'EUR' and f.effective_date < o.turis_created_at::date
  order by f.effective_date desc
  limit 1
) fx_eur on true;
