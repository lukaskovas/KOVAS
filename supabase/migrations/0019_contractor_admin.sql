-- Ręczne dodawanie i edycja kontrahentów w panelu admina (app/admin/kontrahenci).
--
-- companies.id to naturalny klucz z Turis (bigint, zawsze dodatni, podawany jawnie przy
-- każdej synchronizacji - patrz 0001_init.sql). Rekordy dodane ręcznie w panelu nie mają
-- źródła ID w Turis, więc bierzemy je z osobnej sekwencji schodzącej w ujemne. Ujemne ID
-- nigdy nie zderzy się z dodatnim ID z Turis, więc kolejny sync nie nadpisze ręcznego wpisu
-- ani odwrotnie - nie potrzeba osobnej kolumny "source".
--
-- Default jest bezpieczny dla synchronizacji: upsert z Turis zawsze podaje id jawnie,
-- więc sekwencja rusza wyłącznie przy insertach bez id (czyli tych z panelu admina).

create sequence if not exists companies_manual_id_seq
  as bigint
  increment by -1
  start with -1
  minvalue -9223372036854775807
  maxvalue -1
  no cycle
  owned by companies.id;

alter table companies alter column id set default nextval('companies_manual_id_seq');

-- service_role ma już wszystkie uprawnienia (0002_grants.sql: grant all + default privileges),
-- więc nowa sekwencja jest dostępna bez dodatkowych GRANT-ów.

notify pgrst, 'reload schema';
