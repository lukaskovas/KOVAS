-- Handlowiec (opiekun) i typ kontrahenta - dane, których Turis nie oddaje przez API.
--
-- Skąd się biorą: z kartoteki kontrahentów EASI (1699 rekordów, zrzut 2026-07-21).
-- W Turis przypisanie handlowca do firmy ISTNIEJE (POST /companies przyjmuje "agents":[...]),
-- ale GET /companies i /companies/{id} go nie zwracają, a orders.agent/agent_id są puste
-- w 0/10478 zamówień - szczegóły w docs/analiza-easi/LUKI-DANYCH.md sekcja 7.3.
--
-- WAŻNE dla modelu danych: handlowiec jest atrybutem KONTRAHENTA, nie zamówienia. Tak samo
-- działa EASI - w jego raporcie zamówień kolumny "Handlowiec" i "Typ kontrahenta" są puste
-- albo wypełnione ZAWSZE razem, czyli dociągane z kartoteki po NIP przy generowaniu raportu.
-- Dlatego trzymamy je na companies i wchodzą do raportów zamówień przez zwykłe złączenie.

-- ============================================================
-- Surowy zrzut kartoteki EASI - osobno od companies, żeby dało się odtworzyć, skąd wzięło się
-- każde przypisanie, i powtórzyć dopasowanie po zmianie reguł bez ponownego scrapowania panelu.
-- ============================================================
create table if not exists easi_contractors (
  easi_id         bigint primary key,
  name            text,
  nip             text,
  contractor_type text,
  agent           text,
  country_code    text,
  city            text,
  easi_created_at text,
  imported_at     timestamptz not null default now()
);

create index if not exists easi_contractors_nip_idx on easi_contractors (nip);

grant select, insert, update, delete on easi_contractors to service_role;

-- ============================================================
-- Przypisanie na kontrahencie.
-- agent_source zapisuje, JAK trafiliśmy w tego kontrahenta ('nip' / 'name'), bo 748 z 1699
-- rekordów EASI nie ma NIP-u (osoby fizyczne, w kolumnie stoi "-") i dla nich jedynym kluczem
-- jest znormalizowana nazwa. Przy sporze o poprawność przypisania to pierwsza rzecz do sprawdzenia.
-- ============================================================
alter table companies
  add column if not exists agent           text,
  add column if not exists contractor_type text,
  add column if not exists agent_source    text;

create index if not exists companies_agent_idx on companies (agent);

-- ============================================================
-- Migawka raportowa - dokładamy dwie kolumny z companies.
-- Reszta definicji bez zmian względem 0010_mv_full_columns.sql.
-- ============================================================
drop materialized view if exists mv_report_orders;

-- Dlaczego "sales_agent", a nie "agent": v_orders_report wystawia (przez v.*) pole orders.agent
-- prosto z Turis - puste w 0/10478 zamówień, ale zajmujące nazwę. Nazwanie kolumny tak samo
-- kończy się błędem "column agent specified more than once". Martwego pola nie ruszamy, bo
-- należy do surowego odwzorowania Turis i nie jest to zakres tej zmiany.
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

-- ============================================================
-- Filtry: dochodzi p_agent i p_ctype.
--
-- Funkcje trzeba DROPnąć, nie "create or replace": dochodzą nowe parametry, więc powstałaby
-- druga funkcja o innej sygnaturze i wywołania stałyby się niejednoznaczne (ta sama pułapka
-- co w migracji 0008).
-- ============================================================
drop function if exists report_kpi(date, date, text, text, text, text, text);
drop function if exists report_order_ids(date, date, text, text, text, text, text);
drop function if exists report_orders_by(text, date, date, text, text, text, text, text, text, int);
drop function if exists report_products_by(date, date, text, text, text, text, text, text, int);
drop function if exists report_dormant_companies(int, int);

create or replace function report_order_ids(
  p_from     date default null,
  p_to       date default null,
  p_currency text default null,
  p_status   text default null,
  p_country  text default null,
  p_q        text default null,
  p_match    text default null,
  p_agent    text default null,
  p_ctype    text default null
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
    and (p_match    is null or o.invoice_match_status = p_match)
    -- '(brak)' jako jawna wartość filtra: bez tego nie da się wyświetlić samych zamówień
    -- kontrahentów bez przypisanego opiekuna, a to jest realne pytanie ("kto wypada z prowizji")
    and (p_agent    is null or coalesce(o.sales_agent, '(brak)') = p_agent)
    and (p_ctype    is null or coalesce(o.contractor_type, '(brak)') = p_ctype)
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
  p_ctype    text default null
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
    join report_order_ids(p_from, p_to, p_currency, p_status, p_country, p_q, p_match, p_agent, p_ctype) s
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

-- Agregat w dowolnym wymiarze - dochodzą wymiary 'agent' i 'ctype'.
create or replace function report_orders_by(
  p_dim      text,
  p_from     date default null,
  p_to       date default null,
  p_currency text default null,
  p_status   text default null,
  p_country  text default null,
  p_q        text default null,
  p_agent    text default null,
  p_ctype    text default null,
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
  is_time   boolean := p_dim in ('day', 'week', 'month', 'quarter', 'year');
  by_label  boolean := is_time or p_dim = 'dow';
  sort_col  text;
  sort_dir  text;
begin
  key_expr := case p_dim
    when 'company'  then 'coalesce(nullif(btrim(o.company_current_name), ''''), '
                      || 'nullif(btrim(o.company_name), ''''), ''(brak kontrahenta)'')'
    -- Handlowiec i typ kontrahenta pochodzą z kartoteki EASI (patrz nagłówek migracji).
    -- Zamówienia kontrahentów, których w kartotece nie było, lądują w wierszu "(brak ...)"
    -- - to nie jest błąd do ukrycia, tylko realna dziura w danych, którą trzeba widzieć.
    when 'agent'    then 'coalesce(nullif(btrim(o.sales_agent), ''''), ''(brak handlowca)'')'
    when 'ctype'    then 'coalesce(nullif(btrim(o.contractor_type), ''''), ''(brak typu)'')'
    when 'country'  then 'coalesce(o.country_name, ''(brak kraju)'')'
    when 'status'   then 'coalesce(o.current_status_name, ''(brak statusu)'')'
    when 'currency' then 'coalesce(o.currency_code, ''(brak)'')'
    when 'payment'  then 'coalesce(o.payment_method, ''(brak)'')'
    when 'match'    then 'coalesce(o.invoice_match_status, ''(brak faktury)'')'
    when 'day'      then 'to_char(o.turis_created_at, ''YYYY-MM-DD'')'
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
      join report_order_ids($1, $2, $3, $4, $5, $6, null, $7, $8) s on s.id = o.id
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
    limit $9
  $sql$, key_expr, sub_expr, is_time::text, sort_col, sort_dir)
  using p_from, p_to, p_currency, p_status, p_country, p_q, p_agent, p_ctype,
        greatest(1, coalesce(p_limit, 100));
end;
$fn$;

create or replace function report_products_by(
  p_from     date default null,
  p_to       date default null,
  p_currency text default null,
  p_status   text default null,
  p_country  text default null,
  p_q        text default null,
  p_agent    text default null,
  p_ctype    text default null,
  p_sort     text default null,
  p_dir      text default null,
  p_limit    int  default 100
) returns table (
  label           text,
  sublabel        text,
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
        round(coalesce(sum(oi.total_price * o.rate_pln), 0), 2)               as net_pln,
        round(coalesce(sum(oi.total_price * o.rate_pln
              * (1 + coalesce(o.vat_rate, 0) / 100.0)), 0), 2)                as gross_pln,
        round(coalesce(sum(oi.total_price * o.rate_pln), 0)
              / nullif(sum(oi.quantity), 0), 2)                               as avg_price_pln,
        min(o.turis_created_at)::date                                         as first_sale,
        max(o.turis_created_at)::date                                         as last_sale
      from order_items oi
      join mv_report_orders o on o.id = oi.order_id
      join report_order_ids($1, $2, $3, $4, $5, $6, null, $7, $8) s on s.id = oi.order_id
      left join products p on p.id = oi.product_id
      group by 1
    )
    select label, sublabel, ean, orders_count, companies_count, items_qty,
           net_pln, gross_pln, avg_price_pln,
           round(100 * net_pln / nullif(sum(net_pln) over (), 0), 2) as share_pct,
           first_sale, last_sale
    from g
    order by %I %s nulls last, label asc
    limit $9
  $sql$, sort_col, sort_dir)
  using p_from, p_to, p_currency, p_status, p_country, p_q, p_agent, p_ctype,
        greatest(1, coalesce(p_limit, 100));
end;
$fn$;

-- Uśpieni klienci - dochodzi zawężenie do jednego handlowca ("moi klienci do odzyskania")
-- oraz kolumna z opiekunem, żeby na wspólnej liście było widać, kto ma się odezwać.
create or replace function report_dormant_companies(
  p_days  int default 90,
  p_limit int default 100,
  p_agent text default null
) returns table (
  label         text,
  sublabel      text,
  agent         text,
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
    coalesce(max(o.sales_agent), '(brak handlowca)'),
    count(*),
    round(coalesce(sum(o.net_pln), 0), 2),
    round(coalesce(sum(o.net_pln), 0) / nullif(count(*), 0), 2),
    max(o.turis_created_at)::date,
    (current_date - max(o.turis_created_at)::date)::int,
    min(o.turis_created_at)::date
  from mv_report_orders o
  where (p_agent is null or coalesce(o.sales_agent, '(brak)') = p_agent)
  group by 1
  having max(o.turis_created_at)::date < current_date - greatest(1, coalesce(p_days, 90))
  order by 5 desc
  limit greatest(1, coalesce(p_limit, 100));
$$;

-- ============================================================
-- Listy wartości do filtrów - dochodzi handlowiec i typ kontrahenta.
-- Bierzemy je z companies (kartoteka), nie z migawki: handlowiec ma się pojawić na liście
-- także wtedy, gdy jego klienci jeszcze nic nie kupili w wybranym okresie.
-- ============================================================
create or replace view v_filter_options as
  select 'status'   as kind, current_status_name as value from orders where current_status_name is not null
  union
  select 'currency', currency_code               from orders   where currency_code is not null
  union
  select 'match',    match_status                from v_invoice_match_quality where match_status is not null
  union
  select 'country',  country                     from companies where country is not null
  union
  select 'agent',    agent                       from companies where agent is not null
  union
  select 'ctype',    contractor_type             from companies where contractor_type is not null;

grant select on v_filter_options to service_role;

grant execute on function report_order_ids(date, date, text, text, text, text, text, text, text) to service_role;
grant execute on function report_kpi(date, date, text, text, text, text, text, text, text) to service_role;
grant execute on function report_orders_by(text, date, date, text, text, text, text, text, text, text, text, int) to service_role;
grant execute on function report_products_by(date, date, text, text, text, text, text, text, text, text, int) to service_role;
grant execute on function report_dormant_companies(int, int, text) to service_role;

notify pgrst, 'reload schema';
