-- Marża liczona w PLN, nie w walucie zamówienia.
--
-- Błąd sprzed tej migracji: margin = sub_total_price_without_vat - cogs_total odejmował od siebie
-- dwie różne waluty. Przychód (sub_total_price_without_vat) jest w walucie zamówienia (np. EUR),
-- a koszt własny (cogs_total = sum(unit_cost_snapshot)) pochodzi z przyjęć magazynowych wFirmy,
-- czyli ZAWSZE w PLN. Dla zamówień w EUR dawało to nonsensowną, ujemną marżę (od ~5457 EUR
-- odejmowano ~13505 PLN tak, jakby to były euro). Dla zamówień w PLN wynik był poprawny,
-- bo obie liczby były w PLN - stąd problem widoczny tylko na walutach obcych.
--
-- Poprawka: przychód przeliczamy na PLN kursem NBP z dnia poprzedzającego zamówienie (to jest
-- dokładnie net_pln z tego widoku) i od tego odejmujemy koszt w PLN. Zamówienia w PLN mają
-- kurs = 1, więc ich marża nie zmienia się co do grosza. Marża i CoGS są teraz w PLN dla
-- WSZYSTKICH zamówień - w tabeli oznaczone sufiksem PLN (lib/report-columns.ts).
--
-- Raporty zbiorcze ("Raporty") już liczyły to poprawnie (net_pln - cogs_total, migracja 0007) -
-- tej migracji nie dotyczą.
--
-- Zamówienie w obcej walucie bez notowania NBP na swoją datę ma net_pln = NULL, więc i marża
-- wychodzi NULL zamiast fałszywej liczby - spójne z tym, jak takie zamówienia wypadają z sum
-- (missing_rate_count, migracja 0009).
--
-- create or replace (bez dropowania widoku i migawki): zmieniamy tylko WYRAŻENIE kolumny margin,
-- jej nazwa, typ i pozycja się nie zmieniają, więc zależna migawka mv_report_orders pozostaje
-- ważna. Migawkę trzeba tylko odświeżyć na końcu, żeby przeliczyła zmienioną kolumnę.

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
  -- Marża w PLN: przychód netto przeliczony kursem NBP z dnia poprzedzającego (net_pln) minus
  -- koszt własny (już w PLN). Wyrażenie net_pln powtórzone, bo w SQL nie da się odwołać do aliasu
  -- kolumny liczonej w tym samym select. Obca waluta bez kursu -> fx_cur.mid NULL -> marża NULL.
  round(o.sub_total_price_without_vat * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2)
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

-- Migawka pozostaje ważna (kształt kolumn bez zmian) - wystarczy przeliczyć zmienioną marżę.
refresh materialized view mv_report_orders;
