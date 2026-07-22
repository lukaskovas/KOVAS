-- Raport dostaw: ruchy magazynowe PZ/PW per DOKUMENT (dostawa), z rozbiciem na pozycje.
-- Odpowiada na pytanie: ile, w jakiej cenie i którego towaru (SKU + brand) przyjechało w okresie.
--
-- Źródło: wfirma_receipt_layers (pozycje, migracja 0012) + wfirma_receipt_docs (nagłówek/dostawca)
-- + brands (marka po products.brand_id) - wszystko z migracji 0024. Niezależny od sprzedaży.
--
-- Zwraca JEDEN wiersz na dostawę; pozycje jadą w kolumnie `items` (jsonb), żeby UI mogło je
-- rozwinąć pod nagłówkiem (master-detail). Kwoty w PLN (koszty wFirma są w PLN), share_pct 0-100.
--
-- Brand łączymy łańcuchem: pozycja -> wfirma_goods -> products.wfirma_good_id -> products.brand_id
-- -> brands.name. Towar bez dopasowanego produktu Turis wychodzi bez brandu (null) - to nieuniknione,
-- bo marka żyje po stronie Turis, a nie w katalogu wFirma.

create or replace function report_deliveries(
  p_from  date default null,
  p_to    date default null,
  p_type  text default null,   -- 'PZ' | 'PW' | null (oba typy)
  p_q     text default null,
  p_sort  text default null,
  p_dir   text default null,
  p_limit int  default 100
)
returns table (
  doc_id       bigint,
  doc_number   text,
  doc_type     text,
  receipt_date date,
  supplier     text,
  items_count  bigint,
  items_qty    numeric,
  net_pln      numeric,
  share_pct    numeric,
  items        jsonb
)
language plpgsql
stable
as $$
declare
  v_sort text;
  v_dir  text;
  v_type text;
begin
  v_dir := case when lower(coalesce(p_dir, 'desc')) = 'asc' then 'asc' else 'desc' end;
  -- typ dokumentu: tylko PZ/PW wpuszczamy, cokolwiek innego = brak filtra (oba typy)
  v_type := case upper(coalesce(p_type, '')) when 'PZ' then 'PZ' when 'PW' then 'PW' else null end;
  -- whitelist kolumny sortowania - p_sort trafia do identyfikatora, nie wolno wpuścić dowolnego tekstu
  v_sort := case lower(coalesce(p_sort, ''))
    when 'supplier' then 'supplier'
    when 'number'   then 'doc_number'
    when 'type'     then 'doc_type'
    when 'count'    then 'items_count'
    when 'qty'      then 'items_qty'
    when 'net'      then 'net_pln'
    else 'receipt_date'
  end;

  return query execute format($q$
    with lines as (
      select
        l.doc_id,
        l.doc_number,
        l.doc_type,
        l.receipt_date,
        l.good_id,
        l.quantity,
        l.unit_price,
        coalesce(nullif(btrim(g.code), ''), g.name, '(towar ' || l.good_id || ')') as sku,
        g.name as good_name,
        g.ean  as ean,
        b.name as brand
      from wfirma_receipt_layers l
      left join wfirma_goods g on g.id = l.good_id
      -- jeden brand na towar: produkt może mapować wielokrotnie, bierzemy pierwszy z brandem
      left join lateral (
        select p.brand_id
        from products p
        where p.wfirma_good_id = l.good_id and p.brand_id is not null
        order by p.id
        limit 1
      ) pm on true
      left join brands b on b.id = pm.brand_id
      where (%L::text is null or l.doc_type = %L::text)
        and (%L::date is null or l.receipt_date >= %L::date)
        and (%L::date is null or l.receipt_date <= %L::date)
    ),
    docs as (
      select
        ln.doc_id,
        ln.doc_number,
        ln.doc_type,
        ln.receipt_date,
        coalesce(
          nullif(btrim(ct.name), ''),
          case
            when d.contractor_id is not null and d.contractor_id <> 0
              then '(dostawca ' || d.contractor_id || ')'
            else '(brak dostawcy)'
          end
        ) as supplier,
        count(*)                             as items_count,
        sum(ln.quantity)                     as items_qty,
        sum(ln.quantity * ln.unit_price)     as net_pln,
        jsonb_agg(
          jsonb_build_object(
            'sku',        ln.sku,
            'brand',      ln.brand,
            'name',       ln.good_name,
            'ean',        ln.ean,
            'qty',        ln.quantity,
            'unit_price', ln.unit_price,
            'value',      ln.quantity * ln.unit_price
          )
          order by ln.quantity * ln.unit_price desc
        ) as items,
        -- do wyszukiwania po pozycjach: klik w produkt ma znaleźć dostawę, w której przyjechał
        string_agg(
          coalesce(ln.sku, '') || ' ' || coalesce(ln.good_name, '') || ' ' || coalesce(ln.brand, ''),
          ' '
        ) as search_blob
      from lines ln
      left join wfirma_receipt_docs d  on d.doc_id = ln.doc_id
      left join wfirma_contractors ct  on ct.id = d.contractor_id
      group by ln.doc_id, ln.doc_number, ln.doc_type, ln.receipt_date, d.contractor_id, ct.name
    ),
    filtered as (
      select * from docs
      where %L::text is null
         or doc_number  ilike '%%' || %L || '%%'
         or supplier    ilike '%%' || %L || '%%'
         or search_blob ilike '%%' || %L || '%%'
    )
    select
      doc_id, doc_number, doc_type, receipt_date, supplier,
      items_count, items_qty, net_pln,
      round(100 * net_pln / nullif(sum(net_pln) over (), 0), 2) as share_pct,
      items
    from filtered
    order by %I %s nulls last, doc_number desc
    limit %s
  $q$,
    v_type, v_type,
    p_from, p_from, p_to, p_to,
    p_q, p_q, p_q, p_q,
    v_sort, v_dir, greatest(1, coalesce(p_limit, 100))
  );
end;
$$;

grant execute on function report_deliveries(date, date, text, text, text, text, int) to service_role;
