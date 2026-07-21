-- Dokładka do 0008: report_kpi zwraca też liczbę zamówień bez kursu NBP na swoją datę.
--
-- Stare liczenie sum w JS (getOrderTotals) miało to za darmo - widziało pojedyncze wiersze,
-- więc wystarczyło policzyć te z net_pln = null. Agregat w bazie zwraca jeden wiersz, więc
-- gdyby tego nie dodać, po podmianie zniknęłoby ostrzeżenie "N zamówień nie ma kursu NBP
-- i nie weszło do sum" - a to jedyny sygnał, że kafelki pokazują niepełną kwotę. Sumy
-- wyglądałyby wtedy na kompletne, choć nie są.

drop function if exists report_kpi(date, date, text, text, text, text, text);

create or replace function report_kpi(
  p_from     date default null,
  p_to       date default null,
  p_currency text default null,
  p_status   text default null,
  p_country  text default null,
  p_q        text default null,
  p_match    text default null
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
    join report_order_ids(p_from, p_to, p_currency, p_status, p_country, p_q, p_match) s on s.id = o.id
  ),
  it as (
    -- liczba sztuk jest już policzona w migawce; do tabeli pozycji schodzimy tylko po to,
    -- żeby policzyć ile RÓŻNYCH produktów się sprzedało
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

grant execute on function report_kpi(date, date, text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';
