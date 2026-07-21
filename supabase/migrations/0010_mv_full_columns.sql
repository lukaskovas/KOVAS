-- Lista zamówień przechodzi z widoku v_orders_report na migawkę mv_report_orders.
--
-- Powód: pobranie JEDNEJ strony (100 wierszy) z v_orders_report kosztowało ~2,2 s - więcej niż
-- całe liczenie sum po optymalizacji z migracji 0008/0009. Winny jest ten fragment widoku:
--
--     left join (select order_id, sum(unit_cost_snapshot) from order_items group by order_id) oi
--
-- To podzapytanie nie jest skorelowane z konkretnym zamówieniem, więc Postgres nie potrafi
-- ograniczyć go do wyświetlanej strony - żeby oddać 100 wierszy, musi najpierw zagregować
-- wszystkie 89 515 pozycji zamówień. Do tego dochodzą trzy lateral joiny na wiersz.
-- Migawka liczy to RAZ, a lista czyta z niej zwykłym skanem po indeksie.
--
-- Migawka miała dotąd tylko 22 kolumny (tyle, ile potrzebowały agregaty raportowe), a tabela
-- i eksport CSV pokazują ~38 - samo przepięcie wycięłoby 16 kolumn, m.in. wszystkie kwoty
-- w EUR, transport, terminy płatności i dane kursu NBP. Dlatego migawka bierze teraz KOMPLET
-- kolumn widoku (v.*) i dokłada tylko to, czego widok nie ma: company_id i aktualną nazwę
-- kontrahenta (dla agregatów per kontrahent) oraz liczbę sztuk (dla KPI).
--
-- Skutek uboczny do świadomej akceptacji: lista pokazuje teraz stan z ostatniego odświeżenia
-- migawki, nie stan tabel na żywo. Przy ręcznym syncu to bez różnicy - dane i tak zmieniają się
-- tylko przy `npm run backfill`, który kończy się odświeżeniem. Doszło za to odświeżanie
-- w `npm run sync-fx` (skrypt zmienia kursy, więc i kwoty w PLN/EUR).
-- Dodatkowa korzyść: lista i kafelki sum czytają wreszcie z tego samego źródła, więc nie mogą
-- pokazać dwóch różnych stanów tych samych danych.

drop materialized view if exists mv_report_orders;

create materialized view mv_report_orders as
select
  v.*,
  ord.company_id,
  comp.name           as company_current_name,
  coalesce(it.qty, 0) as qty
from v_orders_report v
join orders ord on ord.id = v.id
left join companies comp on comp.id = ord.company_id
left join (select oi.order_id, sum(oi.quantity) as qty from order_items oi group by 1) it
       on it.order_id = v.id;

create unique index mv_report_orders_pkey on mv_report_orders (id);
create index mv_report_orders_date_idx    on mv_report_orders (turis_created_at);
create index mv_report_orders_company_idx on mv_report_orders (company_id);
-- Domyślne sortowanie listy (data malejąco, id rosnąco jako tiebreaker) - żeby pierwsza
-- strona schodziła z indeksu, a nie z sortowania całości.
create index mv_report_orders_default_sort_idx on mv_report_orders (turis_created_at desc, id);
-- Kolumny filtrów z paska nad tabelą.
create index mv_report_orders_status_idx   on mv_report_orders (current_status_name);
create index mv_report_orders_currency_idx on mv_report_orders (currency_code);
create index mv_report_orders_match_idx    on mv_report_orders (invoice_match_status);

grant select on mv_report_orders to service_role;

-- PostgREST musi zobaczyć nowy kształt migawki, inaczej odpytanie jej kolumn kończy się
-- błędem "column does not exist" mimo poprawnego SQL.
notify pgrst, 'reload schema';
