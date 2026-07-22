-- Doprecyzowanie statusu realizacji (z 0021): "wisi" tylko dla zamówień z ERY wFirMY.
--
-- Problem wykryty na danych: faktury wFirma istnieją dopiero od ~01.04.2026 (wcześniej Kovas
-- fakturował w QuickBooks). Naiwne "brak faktury = wisi" oznaczało 9184 zamówień jako wiszące,
-- gdy realnie wiszących (era wFirma, bez faktury) jest ~56 - reszta to stare zamówienia, które
-- NIGDY nie dostaną faktury wFirma. Pokazywanie ich jako "wisi" wprowadza w błąd.
--
-- Poprawka: zamówienia utworzone PRZED pierwszą fakturą wFirma (granica liczona dynamicznie
-- z min(invoice_date), nie na sztywno) i bez faktury -> realization_status = NULL ("-" w UI,
-- czyli "poza oknem wFirmy / nie dotyczy"). "awaiting" (wisi) zostaje tylko dla zamówień z ery
-- wFirmy bez faktury - to realna lista do wyjaśnienia. Zamówienia z fakturą są "invoiced"
-- niezależnie od daty (te 6 sprzed IV.2026 też).
--
-- Matview odtwarzamy (drop+create) - jak w 0021, bo `select v.*` zamraża listę kolumn.

set local statement_timeout = 0;

drop materialized view if exists mv_report_orders;
create materialized view mv_report_orders as
with wfirma_start as (
  -- pierwsza faktura wFirma = początek okna, w którym "brak faktury" znaczy "wisi", a nie "sprzed wFirmy"
  select min(invoice_date)::date as first_date from invoices where invoice_date is not null
)
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
    when ws.first_date is not null and v.turis_created_at::date < ws.first_date then null
    else 'awaiting'
  end                    as realization_status
from v_orders_report v
join orders ord on ord.id = v.id
left join companies comp on comp.id = ord.company_id
left join (select oi.order_id, sum(oi.quantity) as qty from order_items oi group by 1) it
       on it.order_id = v.id
cross join wfirma_start ws;

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
