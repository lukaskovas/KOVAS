-- refresh_reports() przelicza mv_report_orders nad pełnym zbiorem (10k+ zamówień, 90k+ pozycji).
-- Wołane przez PostgREST (supabase-js .rpc), które egzekwuje domyślny statement_timeout roli -
-- a ten jest za krótki: z crona na Vercelu refresh padał na "canceling statement due to statement timeout".
--
-- Funkcja może nieść własny statement_timeout, niezależny od wołającego. 180 s to zapas -
-- realny refresh to rząd kilkunastu sekund, a funkcja crona na Vercelu ma limit 300 s.
alter function refresh_reports() set statement_timeout = '180s';

-- PostgREST trzyma schemat w cache - przeładowanie, żeby zmiana była widoczna od razu.
notify pgrst, 'reload schema';
