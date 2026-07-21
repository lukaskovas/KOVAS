-- Konta użytkowników panelu. Same dane logowania (email, hasło, sesje) trzyma Supabase Auth
-- w schemacie auth - tutaj tylko to, czego Auth nie wie: kto jest adminem.
--
-- Kluczowe: sam fakt posiadania konta w auth.users NIE daje dostępu do panelu. Wstęp ma
-- wyłącznie ktoś, kto ma wiersz w tej tabeli (patrz lib/auth.ts). Dzięki temu nawet gdyby
-- w projekcie Supabase ktoś włączył publiczną rejestrację, obcy użytkownik nic nie zobaczy.

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  created_at timestamptz not null default now()
);

-- Zero dostępu dla anon/authenticated - do tabeli sięga tylko kod server-side
-- przez service_role (który RLS omija). Spójne z 0002_grants.sql.
alter table profiles enable row level security;
