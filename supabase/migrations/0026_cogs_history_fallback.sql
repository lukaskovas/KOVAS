-- CoGS dla zamówień sprzed ery wFirmy: fallback na koszt migracyjny (cena z pierwszego przyjęcia).
--
-- Po migracji 0020 koszt bierzemy z wydań WZ (dokładny, realny) - ale WZ istnieją dopiero od 04.2026,
-- więc ~87% zamówień (historia 2022-2025) miało CoGS/marżę = NULL ("-"). Decyzja z Saszą: dla tych
-- starszych zamówień DOSZACOWAĆ koszt metodą EASI - cena z PIERWSZEGO przyjęcia towaru (widok
-- v_good_unit_cost, w praktyce dokument migracyjny PW z 02.04.2026). Ta sama metoda co EASI, więc
-- nasza marża historyczna zgadza się z ich raportem.
--
-- HIERARCHIA kosztu per zamówienie (pierwszy, który się policzy):
--   1. WZ  - suma purchase_expense z wydań dowiązanej faktury (koszt DOKŁADNY, era wFirmy).
--   2. fallback - suma (cena z pierwszego przyjęcia * ilość) po pozycjach, ale TYLKO gdy KOMPLET:
--      każda pozycja zamówienia musi mapować się na towar wFirma z kosztem > 0. Koszt SZACOWANY.
--   3. NULL - gdy choć jedna pozycja nie ma kosztu (produkt wycofany sprzed migracji, nieobecny
--      w wFirmie) - takiego zamówienia nie da się wycenić żadną metodą, marża zostaje "-".
--
-- unit_cost > 0 w fallbacku jest ISTOTNE: produkt z kosztem 0 to "koszt nieznany", nie "koszt zero"
-- (dokładnie ten błąd naprawiała migracja 0020). Zero w koszcie zawyżyłoby marżę do 100% jak wcześniej.
--
-- Pokrycie na danych 22.07: 1318 zamówień WZ (dokładne) + 4138 szacowanych = 5456/10502 (52%);
-- reszta (5046) dotyka produktów spoza katalogu wFirmy - koszt irredukowalnie nieznany.
--
-- ZAKRES: zmieniamy TYLKO wyrażenie cogs_total (i zależną od niego marżę) w v_orders_report.
-- Kształt kolumn bez zmian -> create or replace, migawka mv_report_orders zostaje ważna (odświeżamy
-- ją na końcu). report_kpi i report_orders_by czytają mv.cogs_total, więc marża, missing_cost_count
-- i agregaty zaktualizują się SAME - bez dotykania tych funkcji.
--
-- Rozróżnienie "koszt dokładny vs szacowany" NIE jest wystawiane jako osobna kolumna (wymagałoby
-- przebudowy migawki, która dorosła o realization_status) - komunikujemy je tekstem w UI: nowsze
-- zamówienia = koszt z WZ, starsze = szacowany metodą migracyjną (jak EASI).

set local statement_timeout = 0;

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

  -- CoGS: WZ (dokładny) -> fallback z pierwszego przyjęcia (szacowany, tylko gdy komplet) -> NULL.
  cost.cogs_total,
  -- Marża BEZ transportu (jak 0018/0020), liczona tylko gdy znamy koszt; inaczej NULL.
  case when cost.cogs_total is null then null
       else round(o.sub_total_price_without_vat * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2)
            - round(coalesce(o.shipping_price, 0) * case when o.currency_code = 'PLN' then 1 else fx_cur.mid end, 2)
            - cost.cogs_total
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
left join lateral (
  select i.id, i.fullnumber, i.match_status, i.currency_exchange, i.currency_label
  from order_invoice_links l
  join invoices i on i.id = l.invoice_id
  where l.order_id = o.id
  order by l.matched_at desc nulls last
  limit 1
) li on true
-- Koszt zamówienia: WZ dowiązanej faktury, a gdy brak - koszt migracyjny (pierwsze przyjęcie),
-- ale tylko jeśli KAŻDA pozycja ma towar wFirma z kosztem > 0 (inaczej NULL = nie do wyceny).
left join lateral (
  select coalesce(
    (select round(sum(il.purchase_expense), 2)
       from wfirma_issue_lines il
      where il.invoice_id = li.id),
    (select case when bool_and(g.unit_cost is not null and g.unit_cost > 0)
                 then round(sum(g.unit_cost * oi.quantity), 2) end
       from order_items oi
       left join products p on p.id = oi.product_id
       left join v_good_unit_cost g on g.good_id = p.wfirma_good_id
      where oi.order_id = o.id)
  ) as cogs_total
) cost on true
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

-- Migawka bez zmiany kształtu - przeliczamy zmienioną marżę/CoGS.
refresh materialized view mv_report_orders;

notify pgrst, 'reload schema';
