-- CoGS: realne koszty własne z magazynu wFirma.
-- Do tej migracji products.unit_cost pochodził z Turis i był w 100% zerowy/NULL, więc kolumny
-- CoGS i Marża w panelu pokazywały zera (patrz docs/analiza-easi/LUKI-DANYCH.md, sekcje 3 i 7.1).
-- Źródłem kosztu są dokumenty przyjęć wFirma (PW/PZ) - moduł `goods` zwraca WYŁĄCZNIE ceny
-- sprzedaży, więc nie nadaje się na koszt.

-- ============================================================
-- wfirma_goods (katalog towarów wFirma - klucz mapowania na products z Turis)
-- ============================================================
create table wfirma_goods (
  id            bigint primary key,               -- wFirma good.id
  name          text not null,
  code          text,                             -- odpowiednik SKU
  ean           text,
  raw           jsonb not null,
  first_seen_at timestamptz not null default now(),
  synced_at     timestamptz not null default now()
);
create index wfirma_goods_ean_idx on wfirma_goods (ean);
create index wfirma_goods_code_idx on wfirma_goods (code);

-- ============================================================
-- wfirma_receipt_layers (warstwy przyjęć - jedna pozycja dokumentu PW/PZ)
-- ============================================================
-- Trzymamy WARSTWY, a nie gotowy koszt per towar, świadomie: metoda liczenia kosztu jest
-- decyzją biznesową, która się zmieni (dziś odtwarzamy metodę EASI, docelowo średnia ważona
-- krocząca). Mając warstwy, zmiana metody to przeliczenie widoku, a nie ponowny sync z wFirmy.
create table wfirma_receipt_layers (
  id            bigint primary key,               -- wFirma warehouse_document_content.id
  good_id       bigint not null,                  -- -> wfirma_goods.id (bez FK: pozycja może wskazywać na towar usunięty z katalogu)
  doc_id        bigint not null,
  doc_number    text not null,
  doc_type      text not null,                    -- PW | PZ
  receipt_date  date not null,
  quantity      numeric not null,
  unit_price    numeric not null,                 -- cena jednostkowa ZAKUPU (netto)
  raw           jsonb not null,
  synced_at     timestamptz not null default now()
);
create index wfirma_receipt_layers_good_idx on wfirma_receipt_layers (good_id, receipt_date);

-- ============================================================
-- mapowanie products (Turis) -> wfirma_goods
-- ============================================================
alter table products add column wfirma_good_id bigint;
-- czym trafiliśmy: ean | code | name | null (niedopasowany) - do raportu jakości mapowania,
-- bo dopasowanie po nazwie jest znacznie mniej pewne niż po EAN
alter table products add column wfirma_match_key text;
create index products_wfirma_good_idx on products (wfirma_good_id);

-- ============================================================
-- v_good_unit_cost - koszt jednostkowy per towar wFirma
-- ============================================================
-- METODA: cena z PIERWSZEGO przyjęcia towaru (odtworzona metoda EASI - patrz sekcja 7.1a).
-- To ŚWIADOMIE nie jest metoda docelowa. Wybrana jako pierwsza, żeby dało się zweryfikować
-- nasze liczby 1:1 z raportem EASI; gdy metoda zostanie zatwierdzona, podmieniamy TEN widok
-- (np. na średnią ważoną kroczącą) i nic poza nim się nie zmienia.
--
-- unit_price > 0: przyjęcia po cenie zerowej to artefakty (np. PZ 11/4/2026 o wartości 0,00),
-- a nie realny koszt - wpuszczone jako "pierwsze przyjęcie" zamroziłyby koszt towaru na zerze.
create view v_good_unit_cost as
select distinct on (good_id)
  good_id,
  unit_price   as unit_cost,
  receipt_date as cost_from_date,
  doc_number   as cost_from_doc
from wfirma_receipt_layers
where unit_price > 0
order by good_id, receipt_date, id;

-- ============================================================
-- apply_product_costs() - przepisuje koszty na products i order_items
-- ============================================================
-- Wołane przez `npm run sync-costs` po synchronizacji warstw. Robione w SQL, nie w JS,
-- bo dotyczy ~90 tys. pozycji zamówień - przepychanie tego przez PostgREST byłoby wolne.
--
-- UWAGA na semantykę: order_items.unit_cost_snapshot mimo nazwy trzyma WARTOŚĆ LINII
-- (koszt × ilość), nie cenę jednostkową - tak liczy to lib/sync/turis.ts i tak sumują to
-- widoki raportowe (sum(unit_cost_snapshot) as cogs_total). Zachowujemy tę semantykę,
-- żeby nie rozjechać widoków; zmiana nazwy jest osobnym zadaniem (LUKI-DANYCH sekcja 7.1, pkt 6).
create or replace function apply_product_costs()
returns table (products_updated bigint, items_updated bigint)
language plpgsql
as $$
declare
  p_count bigint;
  i_count bigint;
begin
  update products p
  set unit_cost = c.unit_cost
  from v_good_unit_cost c
  where p.wfirma_good_id = c.good_id
    and p.unit_cost is distinct from c.unit_cost;
  get diagnostics p_count = row_count;

  update order_items oi
  set unit_cost_snapshot = p.unit_cost * oi.quantity
  from products p
  where p.id = oi.product_id
    and p.unit_cost is not null
    and oi.unit_cost_snapshot is distinct from p.unit_cost * oi.quantity;
  get diagnostics i_count = row_count;

  return query select p_count, i_count;
end;
$$;

-- ============================================================
-- v_cost_coverage - raport jakości: ile produktów faktycznie ma koszt
-- ============================================================
-- Bez tego widoku "CoGS działa" jest nieweryfikowalne: produkt może być dopasowany do towaru
-- wFirma, a mimo to nie mieć kosztu, bo nigdy nie został przyjęty żadnym dokumentem.
create view v_cost_coverage as
select
  count(*)                                                          as products_total,
  count(*) filter (where wfirma_good_id is not null)                as matched,
  count(*) filter (where wfirma_good_id is null)                    as unmatched,
  count(*) filter (where unit_cost is not null and unit_cost > 0)   as with_cost,
  count(*) filter (where wfirma_good_id is not null
                     and (unit_cost is null or unit_cost = 0))      as matched_without_cost,
  count(*) filter (where wfirma_match_key = 'ean')                  as matched_by_ean,
  count(*) filter (where wfirma_match_key = 'code')                 as matched_by_code,
  count(*) filter (where wfirma_match_key = 'name')                 as matched_by_name
from products;
