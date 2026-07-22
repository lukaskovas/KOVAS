-- Raport zakupów per produkt (życzenie Katii: "purchases by product").
-- Strona KOSZTOWA/zakupowa - z dokumentów przyjęć magazynowych wFirma (PW/PZ), które już mamy
-- w wfirma_receipt_layers (migracja 0012). Niezależny od sprzedaży.
--
-- Cło i transport (koszty uboczne zakupu) to OSOBNE wydatki w wFirma, kwotami zbiorczymi na
-- dostawę, nierozbite na produkt - świadomie NIE ma ich w tym raporcie (patrz OTWARTE-PYTANIA A17:
-- czeka na regułę alokacji). Dostawca też jeszcze nie - siedzi na nagłówku PZ, nie zapisujemy go
-- dziś w warstwach (do dołożenia osobno). Ten raport to: ile i za ile kupiliśmy każdego towaru.
--
-- Kształt wyniku zgodny z AggRow (lib/analytics.ts), żeby renderowała go istniejąca tabela i eksport.
-- Kwoty w PLN (koszty wFirma są w PLN). share_pct w skali 0-100, jak pozostałe raporty.

create or replace function report_purchases_by_product(
  p_from  date default null,
  p_to    date default null,
  p_q     text default null,
  p_sort  text default null,
  p_dir   text default null,
  p_limit int  default 100
)
returns table (
  label         text,
  sublabel      text,
  ean           text,
  items_qty     numeric,
  orders_count  bigint,
  net_pln       numeric,
  avg_price_pln numeric,
  first_order   date,
  last_order    date,
  share_pct     numeric
)
language plpgsql
stable
as $$
declare
  v_sort text;
  v_dir  text;
begin
  v_dir := case when lower(coalesce(p_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;
  -- whitelist kolumny sortowania - p_sort trafia do identyfikatora, nie wolno wpuścić dowolnego tekstu
  v_sort := case lower(coalesce(p_sort, ''))
    when 'label'  then 'label'
    when 'name'   then 'sublabel'
    when 'qty'    then 'items_qty'
    when 'orders' then 'orders_count'
    when 'avg'    then 'avg_price_pln'
    when 'first'  then 'first_order'
    when 'last'   then 'last_order'
    else 'net_pln'
  end;

  return query execute format($q$
    with agg as (
      select
        coalesce(nullif(btrim(g.code), ''), g.name, '(towar ' || l.good_id || ')') as label,
        g.name as sublabel,
        g.ean  as ean,
        sum(l.quantity)                                            as items_qty,
        count(distinct l.doc_id)                                   as orders_count,
        sum(l.quantity * l.unit_price)                             as net_pln,
        sum(l.quantity * l.unit_price) / nullif(sum(l.quantity), 0) as avg_price_pln,
        min(l.receipt_date)                                        as first_order,
        max(l.receipt_date)                                        as last_order
      from wfirma_receipt_layers l
      left join wfirma_goods g on g.id = l.good_id
      where (%L::date is null or l.receipt_date >= %L::date)
        and (%L::date is null or l.receipt_date <= %L::date)
      group by l.good_id, g.code, g.name, g.ean
    ),
    filtered as (
      select * from agg
      where %L::text is null
         or label ilike '%%' || %L || '%%'
         or sublabel ilike '%%' || %L || '%%'
    )
    select
      label, sublabel, ean, items_qty, orders_count, net_pln, avg_price_pln,
      first_order, last_order,
      round(100 * net_pln / nullif(sum(net_pln) over (), 0), 2) as share_pct
    from filtered
    order by %I %s nulls last
    limit %s
  $q$,
    p_from, p_from, p_to, p_to,
    p_q, p_q, p_q,
    v_sort, v_dir, greatest(1, coalesce(p_limit, 100))
  );
end;
$$;

grant execute on function report_purchases_by_product(date, date, text, text, text, int) to service_role;
