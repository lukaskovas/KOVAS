-- Raporty zbiorcze (zakładka "Raporty"): agregaty per kontrahent, produkt, okres, kraj,
-- struktura zamówień i klienci uśpieni.
--
-- Dlaczego funkcje w bazie, a nie liczenie w aplikacji: agregat idzie po CAŁYM zbiorze
-- (10 478 zamówień / 89 515 pozycji), a PostgREST i tak odda maksymalnie 1000 wierszy -
-- policzenie sum w JS wymagałoby ściągnięcia wszystkiego i dałoby wynik liczony na próbce.
-- Tu baza zwraca gotowe kilkadziesiąt wierszy raportu.
--
-- Kwoty ZAWSZE w PLN (net_pln itd. z v_orders_report, kurs NBP z dnia poprzedzającego
-- zamówienie - migracje 0005/0006). Sumowanie kolumn w walucie zamówienia mieszałoby
-- złotówki z euro; w danych jest 9358 zamówień PLN, 1112 EUR i 8 USD.

-- ============================================================
-- Spłaszczona podstawa raportów.
--
-- Po co, skoro jest v_orders_report: ten widok ma trzy lateral joiny na wiersz (kurs waluty
-- zamówienia, kurs EUR, ostatnia faktura). Przy 10 478 zamówieniach jeden jego skan kosztuje
-- ~1,5 s, a KAŻDY raport potrzebował go w całości - efekt był taki, że KPI potrafiło przekroczyć
-- 8-sekundowy limit zapytania po stronie API i strona po cichu pokazywała błąd zamiast liczb.
-- Tu liczymy to RAZ, do płaskiej tabeli, po której agregaty idą zwykłym skanem.
--
-- UWAGA: to migawka, nie widok - po każdej synchronizacji danych trzeba ją odświeżyć funkcją
-- refresh_reports() (niżej). Robi to scripts/backfill.ts na koniec oraz `npm run refresh-reports`.
-- Dane w raportach są wtedy dokładnie tak świeże jak sam sync, bo między synchronizacjami
-- źródła się nie zmieniają.
-- ============================================================
drop materialized view if exists mv_report_orders;

create materialized view mv_report_orders as
select
  o.id,
  o.display_order_number,
  ord.company_id,
  comp.name                     as company_current_name,
  o.company_name,
  o.vat_number,
  o.country_code,
  o.country_name,
  o.current_status_name,
  o.currency_code,
  o.payment_method,
  o.invoice_fullnumber,
  o.invoice_match_status,
  o.turis_created_at,
  o.vat_rate,
  o.rate_pln,
  o.net_pln,
  o.gross_pln,
  o.vat_pln,
  o.discount_pln,
  o.cogs_total,
  coalesce(it.qty, 0)           as qty
from v_orders_report o
join orders ord on ord.id = o.id
left join companies comp on comp.id = ord.company_id
left join (select oi.order_id, sum(oi.quantity) as qty from order_items oi group by 1) it
       on it.order_id = o.id;

create unique index mv_report_orders_pkey on mv_report_orders (id);
create index mv_report_orders_date_idx on mv_report_orders (turis_created_at);
create index mv_report_orders_company_idx on mv_report_orders (company_id);

grant select on mv_report_orders to service_role;

-- Odświeżenie migawki. Wołane z aplikacji/skryptów przez PostgREST (rpc), bo tamtędy nie da się
-- wysłać zwykłego DDL-a.
--
-- SECURITY DEFINER jest konieczne: REFRESH wymaga bycia właścicielem migawki, a service_role
-- nim nie jest. search_path przypięty na sztywno - inaczej security definer daje się nabrać
-- na podstawioną ścieżkę schematów.
--
-- Świadomie BEZ opcji CONCURRENTLY: funkcja wykonuje się w transakcji, a REFRESH CONCURRENTLY
-- w transakcji działać nie może. Zwykły refresh blokuje odczyty migawki na czas przeliczenia
-- (rząd sekund, przy synchronizacji nikt nie patrzy w raporty), więc to uczciwy kompromis.
create or replace function refresh_reports()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  refresh materialized view mv_report_orders;
end;
$$;

-- ============================================================
-- Wspólny filtr - jedno miejsce definiujące, co wchodzi do raportu.
-- Pozostałe funkcje joinują się z tym zbiorem id, żeby filtry działały wszędzie tak samo.
--
-- Filtr idzie po mv_report_orders, nie po v_orders_report. Pierwsza wersja szła po widoku
-- i wtedy każde zapytanie liczyło go DWA RAZY (raz tutaj, raz w funkcji nadrzędnej), łącząc
-- go merge joinem z samym sobą.
-- ============================================================
create or replace function report_order_ids(
  p_from     date default null,
  p_to       date default null,
  p_currency text default null,
  p_status   text default null,
  p_country  text default null,
  p_q        text default null
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
    and (p_q        is null or o.company_name ilike '%' || p_q || '%'
                            or o.company_current_name ilike '%' || p_q || '%'
                            or o.display_order_number ilike '%' || p_q || '%'
                            or o.vat_number ilike '%' || p_q || '%'
                            or o.invoice_fullnumber ilike '%' || p_q || '%');
$$;

-- ============================================================
-- KPI - jeden wiersz podsumowania dla aktualnych filtrów.
-- ============================================================
create or replace function report_kpi(
  p_from     date default null,
  p_to       date default null,
  p_currency text default null,
  p_status   text default null,
  p_country  text default null,
  p_q        text default null
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
    join report_order_ids(p_from, p_to, p_currency, p_status, p_country, p_q) s on s.id = o.id
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

-- ============================================================
-- Agregat zamówień w dowolnym wymiarze (kontrahent, kraj, miesiąc, status...).
-- Jedna funkcja zamiast siedmiu prawie identycznych - zmienia się tylko wyrażenie grupujące.
-- ============================================================
create or replace function report_orders_by(
  p_dim      text,
  p_from     date default null,
  p_to       date default null,
  p_currency text default null,
  p_status   text default null,
  p_country  text default null,
  p_q        text default null,
  p_sort     text default null,
  p_dir      text default null,
  p_limit    int  default 100
) returns table (
  label           text,
  sublabel        text,
  orders_count    bigint,
  companies_count bigint,
  items_qty       numeric,
  net_pln         numeric,
  gross_pln       numeric,
  vat_pln         numeric,
  discount_pln    numeric,
  cogs_pln        numeric,
  margin_pln      numeric,
  avg_order_pln   numeric,
  share_pct       numeric,
  prev_net_pln    numeric,
  change_pct      numeric,
  first_order     date,
  last_order      date
)
language plpgsql stable as $fn$
declare
  key_expr  text;
  sub_expr  text := 'null::text';
  -- wymiary czasowe: domyślnie sortowane rosnąco po etykiecie i liczą zmianę do poprzedniego okresu
  is_time   boolean := p_dim in ('day', 'week', 'month', 'quarter', 'year');
  -- dzień tygodnia też ma naturalną kolejność, ale "poprzedni okres" nie ma tu sensu
  by_label  boolean := is_time or p_dim = 'dow';
  sort_col  text;
  sort_dir  text;
begin
  key_expr := case p_dim
    -- Nazwa AKTUALNA z tabeli companies, nie snapshot z zamówienia: orders.company_name jest
    -- zapisem z dnia zamówienia, więc firma po zmianie nazwy rozpadała się na dwie grupy
    -- (1400 grup zamiast 1290 realnych kontrahentów). Snapshot zostaje awaryjnie dla 27
    -- zamówień bez company_id. btrim, bo część nazw w Turis ma wiodącą spację.
    when 'company'  then 'coalesce(nullif(btrim(o.company_current_name), ''''), '
                      || 'nullif(btrim(o.company_name), ''''), ''(brak kontrahenta)'')'
    when 'country'  then 'coalesce(o.country_name, ''(brak kraju)'')'
    when 'status'   then 'coalesce(o.current_status_name, ''(brak statusu)'')'
    when 'currency' then 'coalesce(o.currency_code, ''(brak)'')'
    when 'payment'  then 'coalesce(o.payment_method, ''(brak)'')'
    when 'match'    then 'coalesce(o.invoice_match_status, ''(brak faktury)'')'
    when 'day'      then 'to_char(o.turis_created_at, ''YYYY-MM-DD'')'
    -- tydzień w numeracji ISO, żeby przełom roku nie tworzył tygodnia "0"
    when 'week'     then 'to_char(o.turis_created_at, ''IYYY-"T"IW'')'
    when 'month'    then 'to_char(o.turis_created_at, ''YYYY-MM'')'
    when 'quarter'  then 'to_char(o.turis_created_at, ''YYYY-"Q"Q'')'
    when 'year'     then 'to_char(o.turis_created_at, ''YYYY'')'
    when 'dow'      then 'extract(isodow from o.turis_created_at)::int::text || ''. '' || '
                      || '(array[''poniedziałek'',''wtorek'',''środa'',''czwartek'',''piątek'',''sobota'',''niedziela''])'
                      || '[extract(isodow from o.turis_created_at)::int]'
    else null
  end;

  if key_expr is null then
    raise exception 'Nieznany wymiar raportu: %', p_dim;
  end if;

  if p_dim = 'company' then sub_expr := 'max(o.vat_number)';
  elsif p_dim = 'country' then sub_expr := 'max(o.country_code)';
  end if;

  -- whitelist kolumn sortowania - wartość z URL-a nie może trafić do zapytania wprost
  sort_col := case p_sort
    when 'label'     then 'label'
    when 'orders'    then 'orders_count'
    when 'companies' then 'companies_count'
    when 'qty'       then 'items_qty'
    when 'net'       then 'net_pln'
    when 'gross'     then 'gross_pln'
    when 'avg'       then 'avg_order_pln'
    when 'margin'    then 'margin_pln'
    when 'first'     then 'first_order'
    when 'last'      then 'last_order'
    else null
  end;
  if sort_col is null then
    sort_col := case when by_label then 'label' else 'net_pln' end;
    sort_dir := case when by_label then 'asc' else 'desc' end;
  else
    sort_dir := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;
  end if;

  return query execute format($sql$
    with f as (
      select o.*
      from mv_report_orders o
      join report_order_ids($1, $2, $3, $4, $5, $6) s on s.id = o.id
    ),
    g as (
      select
        %s                                                          as label,
        %s                                                          as sublabel,
        count(*)                                                    as orders_count,
        count(distinct o.company_id)                                as companies_count,
        coalesce(sum(o.qty), 0)                                     as items_qty,
        round(coalesce(sum(o.net_pln), 0), 2)                       as net_pln,
        round(coalesce(sum(o.gross_pln), 0), 2)                     as gross_pln,
        round(coalesce(sum(o.vat_pln), 0), 2)                       as vat_pln,
        round(coalesce(sum(o.discount_pln), 0), 2)                  as discount_pln,
        round(coalesce(sum(o.cogs_total), 0), 2)                    as cogs_pln,
        round(coalesce(sum(o.net_pln), 0) - coalesce(sum(o.cogs_total), 0), 2) as margin_pln,
        round(coalesce(sum(o.net_pln), 0) / nullif(count(*), 0), 2) as avg_order_pln,
        min(o.turis_created_at)::date                               as first_order,
        max(o.turis_created_at)::date                               as last_order
      from f o
      group by 1
    ),
    t as (
      select g.*,
        round(100 * net_pln / nullif(sum(net_pln) over (), 0), 2) as share_pct,
        case when %s then lag(net_pln) over (order by label) end  as prev_net_pln
      from g
    )
    select label, sublabel, orders_count, companies_count, items_qty,
           net_pln, gross_pln, vat_pln, discount_pln, cogs_pln, margin_pln, avg_order_pln,
           share_pct, prev_net_pln,
           round(100 * (net_pln - prev_net_pln) / nullif(prev_net_pln, 0), 1) as change_pct,
           first_order, last_order
    from t
    order by %I %s nulls last, label asc
    limit $7
  $sql$, key_expr, sub_expr, is_time::text, sort_col, sort_dir)
  -- is_time rzutowane na text celowo: format(%s) na booleanie wstawia 't'/'f' (wyjście typu
  -- bool), co SQL czyta jako nazwę kolumny. Rzutowanie daje 'true'/'false'.
  using p_from, p_to, p_currency, p_status, p_country, p_q, greatest(1, coalesce(p_limit, 100));
end;
$fn$;

-- ============================================================
-- Sprzedaż per produkt (poziom pozycji zamówienia).
-- Grupujemy po SKU, nie po product_id: 809 różnych SKU w historii wobec 488 produktów
-- w dzisiejszym katalogu Turis - po product_id wypadłyby wszystkie wycofane produkty.
-- ============================================================
create or replace function report_products_by(
  p_from     date default null,
  p_to       date default null,
  p_currency text default null,
  p_status   text default null,
  p_country  text default null,
  p_q        text default null,
  p_sort     text default null,
  p_dir      text default null,
  p_limit    int  default 100
) returns table (
  label           text,   -- SKU
  sublabel        text,   -- nazwa produktu
  ean             text,
  orders_count    bigint,
  companies_count bigint,
  items_qty       numeric,
  net_pln         numeric,
  gross_pln       numeric,
  avg_price_pln   numeric,
  share_pct       numeric,
  first_sale      date,
  last_sale       date
)
language plpgsql stable as $fn$
declare
  sort_col text;
  sort_dir text;
begin
  sort_col := case p_sort
    when 'label'     then 'label'
    when 'name'      then 'sublabel'
    when 'orders'    then 'orders_count'
    when 'companies' then 'companies_count'
    when 'qty'       then 'items_qty'
    when 'net'       then 'net_pln'
    when 'gross'     then 'gross_pln'
    when 'avg'       then 'avg_price_pln'
    when 'first'     then 'first_sale'
    when 'last'      then 'last_sale'
    else 'net_pln'
  end;
  sort_dir := case when lower(coalesce(p_dir, '')) = 'asc' then 'asc' else 'desc' end;

  return query execute format($sql$
    with g as (
      select
        coalesce(oi.sku, '(brak SKU)')                                        as label,
        max(oi.name)                                                          as sublabel,
        max(p.ean)                                                            as ean,
        count(distinct oi.order_id)                                           as orders_count,
        count(distinct o.company_id)                                          as companies_count,
        coalesce(sum(oi.quantity), 0)                                         as items_qty,
        -- kwoty pozycji są w walucie zamówienia; rate_pln = 1 dla PLN, kurs NBP dla reszty
        round(coalesce(sum(oi.total_price * o.rate_pln), 0), 2)               as net_pln,
        round(coalesce(sum(oi.total_price * o.rate_pln
              * (1 + coalesce(o.vat_rate, 0) / 100.0)), 0), 2)                as gross_pln,
        round(coalesce(sum(oi.total_price * o.rate_pln), 0)
              / nullif(sum(oi.quantity), 0), 2)                               as avg_price_pln,
        min(o.turis_created_at)::date                                         as first_sale,
        max(o.turis_created_at)::date                                         as last_sale
      from order_items oi
      join mv_report_orders o on o.id = oi.order_id
      join report_order_ids($1, $2, $3, $4, $5, $6) s on s.id = oi.order_id
      left join products p on p.id = oi.product_id
      group by 1
    )
    select label, sublabel, ean, orders_count, companies_count, items_qty,
           net_pln, gross_pln, avg_price_pln,
           round(100 * net_pln / nullif(sum(net_pln) over (), 0), 2) as share_pct,
           first_sale, last_sale
    from g
    order by %I %s nulls last, label asc
    limit $7
  $sql$, sort_col, sort_dir)
  using p_from, p_to, p_currency, p_status, p_country, p_q, greatest(1, coalesce(p_limit, 100));
end;
$fn$;

-- ============================================================
-- Klienci uśpieni - kupowali, ale od p_days dni cisza.
-- Świadomie liczone na CAŁEJ historii (bez filtra dat): pytanie brzmi "kto przestał kupować",
-- więc zawężenie do okna dat dałoby fałszywy alarm dla każdego, kto po prostu kupił wcześniej.
-- ============================================================
create or replace function report_dormant_companies(
  p_days  int default 90,
  p_limit int default 100
) returns table (
  label         text,
  sublabel      text,
  orders_count  bigint,
  net_pln       numeric,
  avg_order_pln numeric,
  last_order    date,
  days_since    int,
  first_order   date
)
language sql stable as $$
  select
    coalesce(nullif(btrim(o.company_current_name), ''), nullif(btrim(o.company_name), ''), '(brak kontrahenta)'),
    max(o.vat_number),
    count(*),
    round(coalesce(sum(o.net_pln), 0), 2),
    round(coalesce(sum(o.net_pln), 0) / nullif(count(*), 0), 2),
    max(o.turis_created_at)::date,
    (current_date - max(o.turis_created_at)::date)::int,
    min(o.turis_created_at)::date
  from mv_report_orders o
  group by 1
  having max(o.turis_created_at)::date < current_date - greatest(1, coalesce(p_days, 90))
  order by 4 desc
  limit greatest(1, coalesce(p_limit, 100));
$$;

grant execute on function report_order_ids(date, date, text, text, text, text) to service_role;
grant execute on function report_kpi(date, date, text, text, text, text) to service_role;
grant execute on function report_orders_by(text, date, date, text, text, text, text, text, text, int) to service_role;
grant execute on function report_products_by(date, date, text, text, text, text, text, text, int) to service_role;
grant execute on function report_dormant_companies(int, int) to service_role;
grant execute on function refresh_reports() to service_role;

-- PostgREST trzyma schemat w cache - bez tego nowe funkcje nie są widoczne przez API
-- aż do restartu projektu.
notify pgrst, 'reload schema';
