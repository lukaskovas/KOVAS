-- Zamówienia z ery wFirMY bez faktury ("wiszące") wypadają z przychodu, kosztu i podsumowań.
--
-- Decyzja (Sasza): dopóki zamówienie nie ma faktury, NIE znamy jego kosztu (nie wiadomo, z której
-- warstwy magazynowej zejdzie towar - koszt bywa różny) ANI nie rozpoznajemy przychodu (faktury
-- jeszcze nie ma). Takie zamówienie:
--   - ma koszt NULL (w UI "-"), a nie doszacowany metodą migracyjną,
--   - NIE wchodzi do przychodu, kosztu, marży ani żadnego agregatu (KPI, trend, top-10, handlowcy,
--     kontrahenci, produkty, okresy, kraje, struktura),
--   - jego wartość ląduje w NOWEJ pozycji KPI "wartość zamówień bez faktury".
-- Na liście "Zamówienia" (osobny widok, czyta mv bezpośrednio) wiszące zostają widoczne - jak dotąd.
--
-- ZAKRES "wiszące": tylko realization_status = 'awaiting' = era wFirMY (od 04.2026) bez faktury.
-- Historia sprzed wFirMY (2022-2025, realization_status NULL) NIE jest ruszana: dalej ma przychód
-- i doszacowany koszt migracyjny (metoda EASI, migracja 0026) - te zamówienia nigdy nie dostaną
-- faktury wFirma, więc "brak faktury" znaczy tam co innego niż dla świeżych wiszących.
--
-- Runner (scripts/migrate.ts) owija migrację w transakcję; refresh mv bywa dławiony CPU, więc
-- zdejmujemy limit czasu na czas TEJ transakcji.
set local statement_timeout = 0;

-- ============================================================
-- 1. v_orders_report - fallback kosztu (metoda EASI) TYLKO dla zamówień sprzed ery wFirMY.
--    create or replace: kształt kolumn bez zmian (zmienia się tylko warunek na cogs_total),
--    zależna migawka mv_report_orders zostaje ważna - odświeżamy ją na końcu.
--    Reszta widoku 1:1 z migracji 0026.
-- ============================================================
create or replace view v_orders_report as
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

  -- CoGS: WZ (dokładny, każda era) -> fallback z pierwszego przyjęcia TYLKO dla zamówień sprzed
  -- wFirMY -> NULL. Zamówienie z ery wFirMY bez faktury NIE dostaje szacunku (koszt nieznany).
  cost.cogs_total,
  -- Marża BEZ transportu (jak 0018/0020), liczona tylko gdy znamy koszt; inaczej NULL.
  case when cost.cogs_total is null then null
       else round(o.sub_total_price_without_vat * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2)
            - round(coalesce(o.shipping_price, 0) * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2)
            - cost.cogs_total
  end                           as margin,

  case when o.currency_code = 'PLN' then 1 else fx_cur.mid end       as rate_pln,
  case when o.currency_code = 'EUR' then 1 else fx_eur.mid end       as rate_eur,
  coalesce(fx_cur.table_no, fx_eur.table_no)                         as rate_table_no,
  coalesce(fx_cur.effective_date, fx_eur.effective_date)             as rate_date,

  round(o.sub_total_price_without_vat * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2) as net_pln,
  round(o.grand_total_price           * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2) as gross_pln,
  round(o.discount_price              * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2) as discount_pln,
  round(o.vat_price                   * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2) as vat_pln,

  round(o.sub_total_price_without_vat * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end / nullif(fx_eur.mid, 0), 2) as net_eur,
  round(o.grand_total_price           * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end / nullif(fx_eur.mid, 0), 2) as gross_eur,
  round(o.discount_price              * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end / nullif(fx_eur.mid, 0), 2) as discount_eur,
  round(o.vat_price                   * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end / nullif(fx_eur.mid, 0), 2) as vat_eur
from orders o
left join companies c on c.id = o.company_id
left join lateral (
  select i.id, i.fullnumber, i.match_status, i.currency_exchange, i.currency_label
  from order_invoice_links l
  join invoices i on i.id = l.invoice_id
  where l.order_id = o.id
  order by l.matched_at desc nulls last
  limit 1
) li on true
-- Koszt zamówienia: WZ dowiązanej faktury (dokładny). Gdy brak WZ - fallback migracyjny (pierwsze
-- przyjęcie), ale TYLKO dla zamówień sprzed pierwszej faktury wFirma (era QuickBooks) i tylko gdy
-- KAŻDA pozycja ma towar wFirma z kosztem > 0. Zamówienie z ery wFirMY bez WZ -> NULL (koszt policzymy
-- dopiero po fakturze, z realnego WZ - nie zgadujemy warstwy magazynowej).
left join lateral (
  select coalesce(
    (select round(sum(il.purchase_expense), 2)
       from wfirma_issue_lines il
      where il.invoice_id = li.id),
    case when o.turis_created_at::date < (select min(invoice_date) from invoices where invoice_date is not null)
         then (select case when bool_and(g.unit_cost is not null and g.unit_cost > 0)
                            then round(sum(g.unit_cost * oi.quantity), 2) end
                 from order_items oi
                 left join products p on p.id = oi.product_id
                 left join v_good_unit_cost g on g.good_id = p.wfirma_good_id
                where oi.order_id = o.id)
    end
  ) as cogs_total
) cost on true
left join lateral (
  select f.mid, f.table_no, f.effective_date
  from fx_rates f
  where f.currency = o.currency_code and f.effective_date < o.turis_created_at::date
  order by f.effective_date desc
  limit 1
) fx_cur on o.currency_code <> 'PLN'
left join lateral (
  select f.mid, f.table_no, f.effective_date
  from fx_rates f
  where f.currency = 'EUR' and f.effective_date < o.turis_created_at::date
  order by f.effective_date desc
  limit 1
) fx_eur on true;

-- ============================================================
-- 2. report_order_ids - wspólny filtr wszystkich agregatów. Dokładamy jeden warunek: wiszące
--    (era wFirMY, bez faktury) NIE wchodzą do żadnego podsumowania. Sygnatura bez zmian -> replace.
-- ============================================================
create or replace function report_order_ids(
  p_from     date default null,
  p_to       date default null,
  p_currency text default null,
  p_status   text default null,
  p_country  text default null,
  p_q        text default null,
  p_match    text default null,
  p_agent    text default null,
  p_ctype    text default null,
  p_company  bigint default null
) returns table (id bigint)
language sql stable as $$
  select o.id
  from mv_report_orders o
  where (p_from     is null or o.turis_created_at >= p_from)
    and (p_to       is null or o.turis_created_at <  p_to + 1)
    and (p_currency is null or o.currency_code = p_currency)
    and (p_status   is null or o.current_status_name = p_status)
    and (p_country  is null or o.country_name = p_country)
    and (p_match    is null or o.invoice_match_status = p_match)
    and (p_agent    is null or coalesce(o.sales_agent, '(brak)') = p_agent)
    and (p_ctype    is null or coalesce(o.contractor_type, '(brak)') = p_ctype)
    and (p_company  is null or o.company_id = p_company)
    -- wiszące zamówienia (era wFirMY, jeszcze bez faktury) nie mają rozpoznanego przychodu/kosztu -
    -- wypadają ze wszystkich agregatów. Ich wartość pokazuje osobne KPI (report_kpi.awaiting_net_pln).
    and o.realization_status is distinct from 'awaiting'
    and (p_q        is null or o.company_name ilike '%' || p_q || '%'
                            or o.display_order_number ilike '%' || p_q || '%'
                            or o.vat_number ilike '%' || p_q || '%'
                            or o.invoice_fullnumber ilike '%' || p_q || '%');
$$;

grant execute on function report_order_ids(date, date, text, text, text, text, text, text, text, bigint) to service_role;

-- ============================================================
-- 3. report_kpi - dwie nowe kolumny: liczba i wartość wiszących zamówień (bez faktury).
--    Liczone osobnym skanem mv (bo report_order_ids je już odsiewa), z tym samym zestawem filtrów
--    co reszta KPI (bez p_match - wiszące i tak nie mają dopasowanej faktury).
--    Sygnatura zwracana rośnie o 2 kolumny -> drop + create + re-grant.
-- ============================================================
drop function if exists report_kpi(date, date, text, text, text, text, text, text, text, bigint);
create function report_kpi(
  p_from     date default null,
  p_to       date default null,
  p_currency text default null,
  p_status   text default null,
  p_country  text default null,
  p_q        text default null,
  p_match    text default null,
  p_agent    text default null,
  p_ctype    text default null,
  p_company  bigint default null
) returns table (
  orders_count          bigint,
  companies_count       bigint,
  skus_count            bigint,
  items_qty             numeric,
  net_pln               numeric,
  gross_pln             numeric,
  vat_pln               numeric,
  discount_pln          numeric,
  cogs_pln              numeric,
  margin_pln            numeric,
  avg_order_pln         numeric,
  avg_items_per_order   numeric,
  first_order           date,
  last_order            date,
  missing_rate_count    bigint,
  missing_cost_count    bigint,
  awaiting_orders_count bigint,
  awaiting_net_pln      numeric
)
language sql stable as $$
  with f as (
    select o.*
    from mv_report_orders o
    join report_order_ids(p_from, p_to, p_currency, p_status, p_country, p_q, p_match, p_agent, p_ctype, p_company) s
      on s.id = o.id
  ),
  it as (
    select count(distinct oi.sku) as skus
    from order_items oi
    join f on f.id = oi.order_id
  ),
  -- wiszące zamówienia (era wFirMY, bez faktury) - odsiane z f przez report_order_ids, liczone tu
  -- osobno pod nowy kafelek "wartość zamówień bez faktury". Te same filtry co wyżej, bez p_match.
  aw as (
    select coalesce(sum(o.net_pln), 0) as awaiting_net, count(*) as awaiting_cnt
    from mv_report_orders o
    where o.realization_status = 'awaiting'
      and (p_from     is null or o.turis_created_at >= p_from)
      and (p_to       is null or o.turis_created_at <  p_to + 1)
      and (p_currency is null or o.currency_code = p_currency)
      and (p_status   is null or o.current_status_name = p_status)
      and (p_country  is null or o.country_name = p_country)
      and (p_agent    is null or coalesce(o.sales_agent, '(brak)') = p_agent)
      and (p_ctype    is null or coalesce(o.contractor_type, '(brak)') = p_ctype)
      and (p_company  is null or o.company_id = p_company)
      and (p_q        is null or o.company_name ilike '%' || p_q || '%'
                              or o.display_order_number ilike '%' || p_q || '%'
                              or o.vat_number ilike '%' || p_q || '%'
                              or o.invoice_fullnumber ilike '%' || p_q || '%')
  )
  select
    count(*),
    count(distinct f.company_id),
    (select skus from it),
    coalesce(sum(f.qty), 0),
    round(coalesce(sum(f.net_pln), 0), 2),
    round(coalesce(sum(f.gross_pln), 0), 2),
    round(coalesce(sum(f.vat_pln), 0), 2),
    round(coalesce(sum(f.discount_pln), 0), 2),
    round(coalesce(sum(f.cogs_total) filter (where f.net_pln is not null), 0), 2),
    round(coalesce(sum(f.net_pln) filter (where f.cogs_total is not null and f.net_pln is not null), 0)
          - coalesce(sum(round(coalesce(f.shipping_price, 0) * f.rate_pln, 2)) filter (where f.cogs_total is not null and f.net_pln is not null), 0)
          - coalesce(sum(f.cogs_total) filter (where f.net_pln is not null), 0), 2),
    round(coalesce(sum(f.net_pln), 0) / nullif(count(*), 0), 2),
    round(coalesce(sum(f.qty), 0) / nullif(count(*), 0), 1),
    min(f.turis_created_at)::date,
    max(f.turis_created_at)::date,
    count(*) filter (where f.net_pln is null),
    count(*) filter (where f.cogs_total is null and f.net_pln is not null),
    (select awaiting_cnt from aw),
    round((select awaiting_net from aw), 2)
  from f;
$$;

grant execute on function report_kpi(date, date, text, text, text, text, text, text, text, bigint) to service_role;

-- ============================================================
-- 4. Snapshot domyślnego KPI (migracja 0027) - dwie nowe kolumny + odtworzenie refresh_kpi_snapshot().
-- ============================================================
alter table report_kpi_snapshot add column if not exists awaiting_orders_count bigint;
alter table report_kpi_snapshot add column if not exists awaiting_net_pln      numeric;

create or replace function refresh_kpi_snapshot()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '180s'
as $$
begin
  insert into report_kpi_snapshot as s (
    id, orders_count, companies_count, skus_count, items_qty, net_pln, gross_pln,
    vat_pln, discount_pln, cogs_pln, margin_pln, avg_order_pln, avg_items_per_order,
    first_order, last_order, missing_rate_count, missing_cost_count,
    awaiting_orders_count, awaiting_net_pln, refreshed_at
  )
  select 1, k.orders_count, k.companies_count, k.skus_count, k.items_qty, k.net_pln, k.gross_pln,
         k.vat_pln, k.discount_pln, k.cogs_pln, k.margin_pln, k.avg_order_pln, k.avg_items_per_order,
         k.first_order, k.last_order, k.missing_rate_count, k.missing_cost_count,
         k.awaiting_orders_count, k.awaiting_net_pln, now()
  from report_kpi() k
  on conflict (id) do update set
    orders_count          = excluded.orders_count,
    companies_count       = excluded.companies_count,
    skus_count            = excluded.skus_count,
    items_qty             = excluded.items_qty,
    net_pln               = excluded.net_pln,
    gross_pln             = excluded.gross_pln,
    vat_pln               = excluded.vat_pln,
    discount_pln          = excluded.discount_pln,
    cogs_pln              = excluded.cogs_pln,
    margin_pln            = excluded.margin_pln,
    avg_order_pln         = excluded.avg_order_pln,
    avg_items_per_order   = excluded.avg_items_per_order,
    first_order           = excluded.first_order,
    last_order            = excluded.last_order,
    missing_rate_count    = excluded.missing_rate_count,
    missing_cost_count    = excluded.missing_cost_count,
    awaiting_orders_count = excluded.awaiting_orders_count,
    awaiting_net_pln      = excluded.awaiting_net_pln,
    refreshed_at          = excluded.refreshed_at;
end;
$$;

grant execute on function refresh_kpi_snapshot() to service_role;

-- Migawka odzwierciedla nowy cogs_total (wiszące bez szacunku) - przeliczamy, potem snapshot.
refresh materialized view mv_report_orders;
select refresh_kpi_snapshot();

notify pgrst, 'reload schema';
