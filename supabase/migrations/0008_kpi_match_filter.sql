-- Kafelki sum na zakładce "Zamówienia" przechodzą z liczenia w JS (getOrderTotals - pełny skan
-- całego zbioru porcjami po 1000) na gotowy agregat report_kpi. Żeby ta podmiana nie zmieniła
-- wyświetlanych liczb, funkcje raportowe muszą filtrować DOKŁADNIE tak samo jak lista pod nimi.
--
-- Porównanie obu ścieżek (npm run compare-totals) pokazało dwa rozjazdy do naprawy tutaj:
--
-- 1. Filtr "dopasowanie faktury" był w report_kpi w ogóle nieobsługiwany. Przy match=matched
--    lista pokazywała 1290 zamówień, a kafelki policzyłyby sumy z wszystkich 10 478 - filtr
--    zniknąłby po cichu, a sumy wyglądałyby na poprawne. Stąd p_match.
--
-- 2. Wyszukiwarka szukała po company_current_name (aktualna nazwa kontrahenta), której lista
--    nie przeszukuje. Na frazie "sp" dawało to 2226 zamówień w kafelkach wobec 1988 na liście.
--    Zbiór sum musi opisywać to, co widać w tabeli, więc zostają te same 4 kolumny co w
--    CONFIG.orders.searchColumns (lib/queries.ts).
--
-- Obie funkcje trzeba DROPnąć, nie tylko `create or replace`: dochodzi nowy parametr, więc
-- powstałaby druga funkcja o innej sygnaturze, a wywołania 6-argumentowe stałyby się
-- niejednoznaczne. Pozostałe funkcje raportowe wołają report_order_ids 6 argumentami
-- pozycyjnie - trafią na nową wersję z p_match => null, czyli bez zmiany zachowania.

drop function if exists report_kpi(date, date, text, text, text, text);
drop function if exists report_order_ids(date, date, text, text, text, text);

create or replace function report_order_ids(
  p_from     date default null,
  p_to       date default null,
  p_currency text default null,
  p_status   text default null,
  p_country  text default null,
  p_q        text default null,
  p_match    text default null
) returns table (id bigint)
language sql stable as $$
  select o.id
  from mv_report_orders o
  where (p_from     is null or o.turis_created_at >= p_from)
    -- granica górna włącznie: kolumna to timestamp, więc porównujemy z dniem następnym
    and (p_to       is null or o.turis_created_at <  p_to + 1)
    and (p_currency is null or o.currency_code = p_currency)
    and (p_status   is null or o.current_status_name = p_status)
    and (p_country  is null or o.country_name = p_country)
    -- zwykła równość, tak jak .eq() na liście: zamówienia bez faktury (null) wypadają
    -- z wyniku przy każdej wybranej wartości filtra, i tak samo dzieje się w tabeli
    and (p_match    is null or o.invoice_match_status = p_match)
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
  last_order          date
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
    max(f.turis_created_at)::date
  from f;
$$;

grant execute on function report_order_ids(date, date, text, text, text, text, text) to service_role;
grant execute on function report_kpi(date, date, text, text, text, text, text) to service_role;

-- PostgREST trzyma schemat w cache - bez tego zmienione sygnatury nie są widoczne przez API.
notify pgrst, 'reload schema';
