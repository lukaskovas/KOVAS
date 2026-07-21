-- Tabele utworzone surowym SQL (nie przez UI Supabase) nie dostały automatycznych GRANT-ów,
-- bo "Automatically expose new tables" było świadomie odznaczone przy tworzeniu projektu
-- (bezpieczeństwo: zero dostępu dla anon/authenticated). Ale to też zablokowało service_role,
-- którego potrzebuje nasz kod server-side (lib/supabase.ts) - nadajemy uprawnienia JEMU,
-- nie anon/authenticated, więc pierwotny zamysł bezpieczeństwa zostaje nienaruszony.

grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

-- Żeby przyszłe tabele/sekwencje (kolejne migracje) też automatycznie dostawały te uprawnienia,
-- bez potrzeby pamiętania o tym za każdym razem:
alter default privileges in schema public grant all privileges on tables to service_role;
alter default privileges in schema public grant all privileges on sequences to service_role;
