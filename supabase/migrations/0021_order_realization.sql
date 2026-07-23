-- Status realizacji zamówienia - odróżnia w raporcie zamówienia ZREALIZOWANE (mają fakturę)
-- od WISZĄCYCH (czekają na fakturę) i ANULOWANYCH. To wprost odpowiedź na uwagę klienta:
-- "dodać statusy, żeby przy raportach wiedzieć, które zamówienia wiszą, a które zrealizowane".
--
-- Liczony w migawce z kolumn już obecnych w v_orders_report (invoice_fullnumber - numer faktury
-- dowiązanej do zamówienia, current_status_name - status z Turis), więc nie ruszamy samego widoku.
-- Reguła:
--   invoiced  = zamówienie ma dowiązaną fakturę (faktura wystawiona -> zrealizowane),
--   cancelled = brak faktury, a Turis oznaczył zamówienie jako anulowane/zwrócone/odrzucone
--               (te NIE są "wiszące" - nie czekają na fakturę, nie zaśmiecają listy do wyjaśnienia),
--   awaiting  = brak faktury i zamówienie żyje -> WISI, faktura jeszcze nie powstała/nie zsynchronizowana.
--
-- Migawkę trzeba odtworzyć (drop+create), bo `select v.*` zamraża listę kolumn w chwili tworzenia -
-- nowej kolumny nie da się dołożyć przez sam refresh. Definicja 1:1 z migracji 0015, plus jedna
-- kolumna i indeks pod filtr.

set local statement_timeout = 0;

drop materialized view if exists mv_report_orders;
create materialized view mv_report_orders as
select
  v.*,
  ord.company_id,
  comp.name              as company_current_name,
  comp.agent             as sales_agent,
  comp.contractor_type   as contractor_type,
  coalesce(it.qty, 0)    as qty,
  case
    when v.invoice_fullnumber is not null then 'invoiced'
    when lower(coalesce(v.current_status_name, '')) in ('cancelled', 'canceled', 'refunded', 'declined') then 'cancelled'
    else 'awaiting'
  end                    as realization_status
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
create index mv_report_orders_realization_idx on mv_report_orders (realization_status);

grant select on mv_report_orders to service_role;

notify pgrst, 'reload schema';
