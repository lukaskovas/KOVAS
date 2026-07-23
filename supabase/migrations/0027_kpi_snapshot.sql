-- ============================================================
-- Snapshot domyślnego KPI (cała historia, bez filtrów).
--
-- Problem: instancja bazy jest burstowa - to SAMO zapytanie report_kpi() raz wykonuje się
-- w ~0,5 s, raz w 12 s+ (dławiony CPU, zmierzone EXPLAIN ANALYZE: internal 510 ms vs 12090 ms).
-- Domyślny widok panelu ("Raport zamówień", cała historia) liczył je NA ŻYWO przy każdym wejściu
-- i przekraczał limit 8 s API -> czarna strona / długie ładowanie.
--
-- Rozwiązanie: liczymy domyślne KPI RAZ na cykl odświeżenia raportów (funkcja z własnym
-- statement_timeout 180 s, więc dławienie jej nie ubija) i zapisujemy jeden wiersz. Panel czyta
-- go natychmiast (odczyt 1 wiersza jest odporny na dławienie CPU). Filtrowane KPI dalej liczą się
-- na żywo (rzadsze, streamowane, z łagodnym fallbackiem).
-- ============================================================

-- Jeden logiczny wiersz (singleton: id wymuszony na 1). Kolumny 1:1 z wynikiem report_kpi().
create table if not exists report_kpi_snapshot (
  id                  smallint primary key default 1 check (id = 1),
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
  missing_cost_count  bigint,
  refreshed_at        timestamptz not null default now()
);

-- Panel czyta przez service_role (bypass RLS); RLS włączone bez polityk odcina anon/authenticated.
alter table report_kpi_snapshot enable row level security;
grant select on report_kpi_snapshot to service_role;

-- Liczy domyślne KPI (wszystkie parametry null = cała historia) i upsertuje singleton.
-- security definer + własny statement_timeout 180 s: przelicza się nawet przy dławionym CPU,
-- niezależnie od 8 s limitu wołającego (ta sama sztuczka co refresh_reports, migracja 0014).
create or replace function refresh_kpi_snapshot()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '180s'
as $$
begin
  insert into report_kpi_snapshot as s (
    id, orders_count, companies_count, skus_count, items_qty, net_pln, gross_pln,
    vat_pln, discount_pln, cogs_pln, margin_pln, avg_order_pln, avg_items_per_order,
    first_order, last_order, missing_rate_count, missing_cost_count, refreshed_at
  )
  select 1, k.orders_count, k.companies_count, k.skus_count, k.items_qty, k.net_pln, k.gross_pln,
         k.vat_pln, k.discount_pln, k.cogs_pln, k.margin_pln, k.avg_order_pln, k.avg_items_per_order,
         k.first_order, k.last_order, k.missing_rate_count, k.missing_cost_count, now()
  from report_kpi() k
  on conflict (id) do update set
    orders_count        = excluded.orders_count,
    companies_count     = excluded.companies_count,
    skus_count          = excluded.skus_count,
    items_qty           = excluded.items_qty,
    net_pln             = excluded.net_pln,
    gross_pln           = excluded.gross_pln,
    vat_pln             = excluded.vat_pln,
    discount_pln        = excluded.discount_pln,
    cogs_pln            = excluded.cogs_pln,
    margin_pln          = excluded.margin_pln,
    avg_order_pln       = excluded.avg_order_pln,
    avg_items_per_order = excluded.avg_items_per_order,
    first_order         = excluded.first_order,
    last_order          = excluded.last_order,
    missing_rate_count  = excluded.missing_rate_count,
    missing_cost_count  = excluded.missing_cost_count,
    refreshed_at        = excluded.refreshed_at;
end;
$$;

grant execute on function refresh_kpi_snapshot() to service_role;

-- Doczepiamy snapshot do refresh_reports(): każdy, kto odświeża raporty (cron sync/invoices,
-- npm run refresh-reports, edycja kontrahenta), aktualizuje też snapshot. Jedno miejsce prawdy.
-- UWAGA: create or replace zastępuje klauzule SET, więc ODTWARZAMY statement_timeout 180 s
-- z migracji 0014 (inaczej refresh materialized view wróciłby pod 8 s limit i padał na dużym MV).
create or replace function refresh_reports()
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '180s'
as $$
begin
  refresh materialized view mv_report_orders;
  perform refresh_kpi_snapshot();
end;
$$;

-- Pierwsze wypełnienie snapshotu od razu przy migracji (bez czekania na pierwszy sync).
-- Migracja idzie połączeniem bezpośrednim (scripts/migrate.ts), więc zdejmujemy limit czasu -
-- nawet zdławione ~30 s przejdzie.
set local statement_timeout = 0;
select refresh_kpi_snapshot();
