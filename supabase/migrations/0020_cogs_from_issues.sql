-- CoGS z FAKTYCZNYCH wydań magazynowych (WZ) zamiast zgadywania z przyjęć.
--
-- DOTYCHCZAS (migracja 0012): koszt zgadywaliśmy metodą EASI - cena z pierwszego przyjęcia towaru
-- (v_good_unit_cost), zamrożona na kwietniu 2026, przepisywana na order_items.unit_cost_snapshot.
-- Skutki uboczne: 71 produktów bez żadnego przyjęcia miało koszt NULL/0, więc w raporcie
-- pokazywały marżę = cały przychód = 100% (apka myliła "koszt nieznany" z "koszt zero").
--
-- TERAZ: każde wydanie WZ w wFirmie niesie realny koszt własny wydanego towaru
-- (warehouse_document_content.purchase_expense) oraz dowiązanie do faktury (invoice.id).
-- Faktura łączy się z zamówieniem Turis przez order_invoice_links. Bierzemy więc koszt z pozycji
-- faktycznie zdjętej z magazynu, a nie z uśrednień/pierwszego przyjęcia - dokładnie to, czym
-- wFirma obciążyła daną sprzedaż. Zweryfikowane na danych: purchase_expense/count zgadza się
-- co do grosza z ceną z pierwszego przyjęcia dla 295/332 towarów (mediana stosunku 1.000).
--
-- ZASADA "brak danych, nie zero": koszt znamy tylko dla ery wFirmy (od 04.2026, gdy zaczęły
-- powstawać WZ). Zamówienia sprzed wFirmy (2022-2025) nie mają i nie będą miały WZ. Dla nich
-- CoGS i marża = NULL (w UI "-"), a NIE 0/100%. KPI sumuje marżę tylko po zamówieniach z policzonym
-- kosztem i pokazuje licznik ile pominięto - jak przy brakującym kursie NBP (missing_rate_count).
--
-- Metoda kosztu z przyjęć (v_good_unit_cost, apply_product_costs, unit_cost_snapshot) NIE jest
-- usuwana - products.unit_cost i widok pokrycia v_cost_coverage dalej z niej korzystają jako
-- materiał porównawczy. Przestaje tylko zasilać marżę w raportach.

-- Migracja kończy się `refresh materialized view mv_report_orders`. Na tej bazie refresh potrafił
-- oberwać o statement_timeout (znana pułapka - patrz notatki projektu). Runner (scripts/migrate.ts)
-- owija całość w transakcję, więc zdejmujemy limit na czas TEJ migracji (set local = tylko ta
-- transakcja, nie globalnie).
set local statement_timeout = 0;

-- ============================================================
-- wfirma_issue_lines - pozycje wydań WZ (realny koszt własny per sprzedaż)
-- ============================================================
create table wfirma_issue_lines (
  id                bigint primary key,   -- warehouse_document_content.id (pozycja WZ)
  good_id           bigint not null,      -- -> wfirma_goods.id (bez FK: towar mógł zniknąć z katalogu)
  invoice_id        bigint not null,      -- = wFirma invoice.id = invoices.id (klucz do zamówienia)
  invoicecontent_id bigint,               -- pozycja faktury, do audytu 1:1 pozycja-koszt
  doc_id            bigint not null,
  doc_number        text not null,        -- np. "WZ 1/4/2026"
  issue_date        date not null,
  quantity          numeric not null,
  purchase_expense  numeric not null,     -- koszt własny wydania (netto PLN), wg wyceny wFirma
  raw               jsonb not null,
  synced_at         timestamptz not null default now()
);
create index wfirma_issue_lines_invoice_idx on wfirma_issue_lines (invoice_id);
create index wfirma_issue_lines_good_idx on wfirma_issue_lines (good_id, invoice_id);

grant select on wfirma_issue_lines to service_role;

-- ============================================================
-- 1. v_orders_report - koszt/marża per zamówienie z WZ
--    create or replace: kształt kolumn bez zmian (cogs_total/margin tylko zmieniają wyrażenie
--    i stają się NULL-owalne), więc zależna migawka mv_report_orders pozostaje ważna - wystarczy
--    ją odświeżyć na końcu. Reszta widoku 1:1 z migracji 0018.
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

  -- CoGS = suma kosztu własnego z pozycji WZ faktury dowiązanej do zamówienia.
  -- NULL (nie 0!) gdy zamówienie nie ma faktury z WZ -> "koszt nieznany", nie "koszt zero".
  wz.cogs_total                 as cogs_total,
  -- Marża BEZ transportu (jak w 0018), ale liczona TYLKO gdy znamy koszt; inaczej NULL.
  --   marża = (przychód netto - transport) w PLN, minus koszt własny (już w PLN)
  case when wz.cogs_total is null then null
       else round(o.sub_total_price_without_vat * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2)
            - round(coalesce(o.shipping_price, 0) * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2)
            - wz.cogs_total
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
-- faktura dowiązana do zamówienia (najświeższe dopasowanie) - to samo źródło co numer faktury,
-- rozszerzone o i.id, żeby z tej samej faktury policzyć koszt z WZ.
left join lateral (
  select i.id, i.fullnumber, i.match_status, i.currency_exchange, i.currency_label
  from order_invoice_links l
  join invoices i on i.id = l.invoice_id
  where l.order_id = o.id
  order by l.matched_at desc nulls last
  limit 1
) li on true
-- koszt własny z pozycji WZ tej faktury. Brak wierszy -> sum() = NULL -> cogs_total NULL.
left join lateral (
  select round(sum(il.purchase_expense), 2) as cogs_total
  from wfirma_issue_lines il
  where il.invoice_id = li.id
) wz on true
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
-- 2. v_order_items_report - CoGS per pozycja sprzedaży (widok "Produkty" w tabeli szczegółowej)
--    create or replace: kolumna cogs bez zmian co do nazwy/typu, zmienia się tylko jej źródło
--    (z order_items.unit_cost_snapshot na koszt z pozycji WZ tego samego towaru w tej fakturze).
-- ============================================================
create or replace view v_order_items_report as
select
  oi.id,
  oi.order_id,
  o.display_order_number,
  o.company_name,
  c.vat_number,
  c.country_iso_code            as country_code,
  c.country                     as country_name,
  o.turis_created_at,
  (o.turis_created_at::date + coalesce((o.raw ->> 'payment_terms')::numeric, 0)::int) as payment_due_date,
  oi.name                       as product_name,
  oi.sku,
  p.ean,
  p.brand_id,
  oi.quantity,
  oi.price                      as unit_price_net,
  round(oi.price * (1 + coalesce(o.vat_rate, 0) / 100.0), 2)         as unit_price_gross,
  oi.discount,
  oi.total_price                as total_price_net,
  round(oi.total_price * (1 + coalesce(o.vat_rate, 0) / 100.0), 2)   as total_price_gross,
  round(oi.price * coalesce(o.vat_rate, 0) / 100.0, 2)               as vat_amount_per_unit,
  oi.final_price,
  o.currency_code,
  o.vat_rate,
  -- CoGS pozycji = koszt własny z WZ tego towaru w fakturze dowiązanej do zamówienia.
  -- NULL (w UI "-") gdy pozycji nie da się dopasować do wydania - nie pokazujemy zmyślonego zera.
  wz.cogs                       as cogs
from order_items oi
join orders o on o.id = oi.order_id
left join companies c on c.id = o.company_id
left join products p on p.id = oi.product_id
left join lateral (
  select l.invoice_id
  from order_invoice_links l
  where l.order_id = oi.order_id
  order by l.matched_at desc nulls last
  limit 1
) inv on true
left join lateral (
  select round(sum(il.purchase_expense), 2) as cogs
  from wfirma_issue_lines il
  where il.invoice_id = inv.invoice_id and il.good_id = p.wfirma_good_id
) wz on true;

-- ============================================================
-- 3. report_kpi - kafelki CoGS/Marża + nowy licznik zamówień bez kosztu
--    Sygnatura zmienia się o jedną kolumnę zwracaną (missing_cost_count), więc drop + create.
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
  missing_rate_count  bigint,
  missing_cost_count  bigint
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
    -- CoGS: suma po zamówieniach objętych marżą (koszt znany I jest kurs, więc net_pln policzone).
    -- To samo źródło co marża niżej, żeby kafelki CoGS i Marża opisywały ten sam zbiór zamówień.
    round(coalesce(sum(f.cogs_total) filter (where f.net_pln is not null), 0), 2),
    -- Marża: liczona TYLKO na zamówieniach z policzonym kosztem, inaczej zawyżałyby ją zamówienia
    -- bez kosztu (przychód jest, CoGS 0). Warunek net_pln is not null == ten sam, przy którym marża
    -- per-zamówienie w v_orders_report jest niepusta (obca waluta bez kursu NBP -> net_pln i marża NULL).
    round(coalesce(sum(f.net_pln) filter (where f.cogs_total is not null and f.net_pln is not null), 0)
          - coalesce(sum(round(coalesce(f.shipping_price, 0) * f.rate_pln, 2)) filter (where f.cogs_total is not null and f.net_pln is not null), 0)
          - coalesce(sum(f.cogs_total) filter (where f.net_pln is not null), 0), 2),
    round(coalesce(sum(f.net_pln), 0) / nullif(count(*), 0), 2),
    round(coalesce(sum(f.qty), 0) / nullif(count(*), 0), 1),
    min(f.turis_created_at)::date,
    max(f.turis_created_at)::date,
    count(*) filter (where f.net_pln is null),
    -- ile zamówień (z policzonym przychodem) nie ma kosztu - marża ich nie obejmuje
    count(*) filter (where f.cogs_total is null and f.net_pln is not null)
  from f;
$$;

-- Drop skasował grant z migracji 0016 - odtwarzamy (te same typy argumentów, zmieniły się tylko
-- kolumny zwracane).
grant execute on function report_kpi(date, date, text, text, text, text, text, text, text, bigint) to service_role;

-- ============================================================
-- 4. report_orders_by - marża/CoGS w raportach zbiorczych, NULL-aware jak w KPI.
--    Sygnatura bez zmian -> create or replace. Zmiana tylko w wyrażeniach cogs_pln/margin_pln.
--    (Dziś żaden raport zbiorczy nie POKAZUJE tych kolumn, ale trzymamy je spójnie z KPI.)
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
        -- CoGS/marża tylko z zamówień objętych marżą (koszt znany I policzony net_pln); grupa
        -- bez takich zamówień -> filter daje NULL -> "-" w UI. Warunek jak w KPI i w marży per-zamówienie.
        round(sum(o.cogs_total) filter (where o.cogs_total is not null and o.net_pln is not null), 2) as cogs_pln,
        round(sum(o.net_pln) filter (where o.cogs_total is not null and o.net_pln is not null)
              - sum(round(coalesce(o.shipping_price, 0) * o.rate_pln, 2)) filter (where o.cogs_total is not null and o.net_pln is not null)
              - sum(o.cogs_total) filter (where o.cogs_total is not null and o.net_pln is not null), 2) as margin_pln,
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

-- Migawka odzwierciedla nowe kolumny cogs_total/margin (kształt bez zmian) - przeliczamy.
refresh materialized view mv_report_orders;

notify pgrst, 'reload schema';
