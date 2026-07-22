-- Marża liczona BEZ transportu.
--
-- Ustalenie z Saszą: transport doliczony do zamówienia to przychód przejściowy - klient płaci
-- za wysyłkę, to nie jest nasz przychód. Wcześniej marża liczyła się od pełnego przychodu netto,
-- który (potwierdzone w migracji 0015) ZAWIERA transport:
--   sub_total_price_without_vat = produkty - rabat + transport netto
-- więc marża była zawyżona o kwotę transportu doliczoną do zamówienia.
--
-- Zakres: zmieniamy TYLKO marżę. Przychód netto (net_pln) świadomie zostaje z transportem -
-- to nadal pełna wartość zamówienia w raportach; zmiana dotyczy wyłącznie wyrażenia marży.
--
-- Transport w PLN liczymy tak samo jak net_pln (ten sam kurs NBP z dnia poprzedzającego, to samo
-- zaokrąglenie), żeby marża per-zamówienie i marża w agregatach zgadzały się co do grosza:
--   transport_pln = round(coalesce(shipping_price, 0) * kurs, 2)
--   marża         = net_pln - transport_pln - cogs_total   (= products_net w PLN - koszt towaru)
-- Zamówienia bez transportu (shipping_price NULL) -> coalesce -> 0 -> marża bez zmian.
-- Obca waluta bez notowania NBP -> kurs NULL -> net_pln i transport_pln NULL -> marża NULL,
-- spójnie z migracją 0017 (takie zamówienia i tak wypadają z sum przez missing_rate).
--
-- Trzy miejsca liczące marżę (frontend tylko sumuje/wyświetla te kolumny):
--   1. v_orders_report.margin        - marża per zamówienie (lista "Zamówienia", suma w KPI listy)
--   2. report_kpi.margin_pln         - kafelek "Marża" w widoku Zamówień (0016)
--   3. report_orders_by.margin_pln   - marża w raportach zbiorczych (0011)
-- report_products_by nie liczy marży (transport i tak nie jest przypisany do pozycji produktu).

-- ============================================================
-- 1. Widok per-zamówienie. create or replace (bez dropowania) - zmieniamy tylko WYRAŻENIE kolumny
--    margin, jej nazwa/typ/pozycja się nie zmieniają, więc zależna migawka mv_report_orders
--    pozostaje ważna (trzeba ją tylko odświeżyć na końcu). Reszta widoku 1:1 z migracji 0017.
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
  -- Suma produktów = wartość zamówienia bez transportu (patrz migracja 0015)
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
  -- Marża w PLN BEZ transportu: (przychód netto - transport) w PLN, minus koszt własny (już w PLN).
  -- Wyrażenia net_pln i transport_pln powtórzone, bo w SQL nie da się odwołać do aliasu kolumny
  -- z tego samego select. Obca waluta bez kursu -> fx_cur.mid NULL -> marża NULL.
  round(o.sub_total_price_without_vat * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2)
    - round(coalesce(o.shipping_price, 0) * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2)
    - coalesce(oi.cogs_total, 0)                                     as margin,

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

-- ============================================================
-- 2. KPI kafelka "Marża" w widoku Zamówień. Sygnatura bez zmian względem 0016 -> create or replace.
--    Zmiana tylko w wyrażeniu margin_pln: odejmujemy sumę transportu w PLN.
--    transport_pln per zamówienie = round(coalesce(shipping_price, 0) * rate_pln, 2) - to samo
--    wyrażenie i kurs (rate_pln) co net_pln w migawce, więc zgadza się z marżą per-zamówienie.
-- ============================================================
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
    round(coalesce(sum(f.net_pln), 0)
          - coalesce(sum(round(coalesce(f.shipping_price, 0) * f.rate_pln, 2)), 0)
          - coalesce(sum(f.cogs_total), 0), 2),
    round(coalesce(sum(f.net_pln), 0) / nullif(count(*), 0), 2),
    round(coalesce(sum(f.qty), 0) / nullif(count(*), 0), 1),
    min(f.turis_created_at)::date,
    max(f.turis_created_at)::date,
    count(*) filter (where f.net_pln is null)
  from f;
$$;

-- ============================================================
-- 3. Marża w raportach zbiorczych. Sygnatura bez zmian względem 0011 -> create or replace.
--    Zmiana tylko w wyrażeniu margin_pln (ta sama korekta o transport co w KPI).
-- ============================================================
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
        round(coalesce(sum(o.net_pln), 0)
              - coalesce(sum(round(coalesce(o.shipping_price, 0) * o.rate_pln, 2)), 0)
              - coalesce(sum(o.cogs_total), 0), 2) as margin_pln,
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

-- Migawka pozostaje ważna (kształt kolumn bez zmian) - wystarczy przeliczyć zmienioną marżę.
refresh materialized view mv_report_orders;

notify pgrst, 'reload schema';
