# Kovas - panel

Panel odtwarzający integrator EASI (Turis → wFirma). Next.js na Vercelu, backend Supabase.

## Deploy - WAŻNE

**Vercel NIE jest podłączony do GitHuba.** Push na GitHub NIE odpala deployu automatycznie.
Update trzeba wypchnąć ręcznie przez Vercel CLI z tego katalogu:

- Preview: `vercel`
- Produkcja (`kovas-panel.vercel.app`): `vercel --prod`

Projekt jest już zlinkowany (`.vercel/project.json`, projekt `kovas-panel`).
Deploy na produkcję = operacja produkcyjna - rób tylko na wyraźne polecenie.

## Migracje

Migracje SQL w `supabase/migrations/` to same pliki - trzeba je osobno zastosować na Supabase
przez `npm run migrate` (śledzone w tabeli `_migrations`).

Migracje stosuj przez `npm run migrate`. Jeśli wyjątkowo wgrywasz coś do bazy poza runnerem
(SQL editor, ręczne `pg`), ZAWSZE dopisz nazwę pliku do tabeli `_migrations` - inaczej runner
uruchomi go ponownie i padnie (tak było z `0024`: tabele istniały, brakowało wpisu w `_migrations`;
już pogodzone, runner przechodzi). Migracje pisz idempotentnie
(`create table if not exists` / `drop`-`create` / `create or replace`).

## Automatyczna synchronizacja

Dane odświeżają się przez Vercel Cron (`vercel.json`, `app/api/cron/`): Turis co 15 min, faktury
wFirma co godzinę. Autoryzacja crona przez env `CRON_SECRET`. Pełny backfill historii dalej ręcznie
i lokalnie (`npm run backfill` - za długo dla funkcji serverless).
