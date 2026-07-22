-- Filtr listy zamówień po konkretnym kontrahencie.
--
-- Po co osobno od wyszukiwarki `q`: `q` szuka po NAZWIE (fragment, dopasowuje wiele firm
-- i myli się przy zmianie nazwy). Ten filtr celuje w jednego kontrahenta po stabilnym
-- company_id - firma zostaje jednym wpisem także po zmianie nazwy w Turis.
--
-- Zakres: tylko widok "Zamówienia" (lista + kafelki KPI + eksport). Raporty zbiorcze
-- (report_orders_by, report_products_by, uśpieni) świadomie zostają bez zmian - dlatego
-- p_company dochodzi tylko do report_order_ids i report_kpi, a ich pozostali (9-argumentowi)
-- wywołujący dostają domyślne null, czyli brak zawężenia.

-- ============================================================
-- Lista kontrahentów do wyszukiwarki filtra - tylko ci, którzy mają zamówienia.
-- Nazwa: bieżąca z kartoteki (companies.name).
--
-- Celowo oparte o tabele bazowe companies+orders, NIE o mv_report_orders: migawkę inne
-- migracje regularnie dropują i odtwarzają (0011, 0015_order_products_value), a widok na niej
-- zablokowałby taki drop zależnością. Tu tej zależności nie ma.
-- ============================================================
create or replace view v_order_contractors as
  select
    c.id,
    coalesce(nullif(btrim(c.name), ''), '(brak nazwy)') as name
  from companies c
  where exists (select 1 from orders o where o.company_id = c.id);

grant select on v_order_contractors to service_role;

-- ============================================================
-- Dokładamy p_company. Funkcje trzeba DROPnąć - dochodzi nowy parametr, więc powstałaby
-- druga funkcja o innej sygnaturze i wywołania stałyby się niejednoznaczne (ta sama pułapka
-- co w migracjach 0008 i 0011). p_company jest ostatnim parametrem, żeby dotychczasowe
-- wywołania pozycyjne z report_orders_by/report_products_by (9 argumentów) nadal pasowały.
-- ============================================================
drop function if exists report_order_ids(date, date, text, text, text, text, text, text, text);
drop function if exists report_kpi(date, date, text, text, text, text, text, text, text);

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
    and (p_q        is null or o.company_name ilike '%' || p_q || '%'
                            or o.display_order_number ilike '%' || p_q || '%'
                            or o.vat_number ilike '%' || p_q || '%'
                            or o.invoice_fullnumber ilike '%' || p_q || '%');
$$;

create or replace function report_kpi(
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
  orders_count        bigint,
  companies_count     bigint,
  skus_count          bigint,
  items_qty           numeric,
  net_pln             numeric,
  gross_pln           numeric,
  vat_pln             numeric,
  discount_pln        numeric,
  cogs_pln            numeric,
  margin_pln          numeric,
  avg_order_pln       numeric,
  avg_items_per_order numeric,
  first_order         date,
  last_order          date,
  missing_rate_count  bigint
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
    round(coalesce(sum(f.cogs_total), 0), 2),
    round(coalesce(sum(f.net_pln), 0) - coalesce(sum(f.cogs_total), 0), 2),
    round(coalesce(sum(f.net_pln), 0) / nullif(count(*), 0), 2),
    round(coalesce(sum(f.qty), 0) / nullif(count(*), 0), 1),
    min(f.turis_created_at)::date,
    max(f.turis_created_at)::date,
    count(*) filter (where f.net_pln is null)
  from f;
$$;

grant execute on function report_order_ids(date, date, text, text, text, text, text, text, text, bigint) to service_role;
grant execute on function report_kpi(date, date, text, text, text, text, text, text, text, bigint) to service_role;

notify pgrst, 'reload schema';
