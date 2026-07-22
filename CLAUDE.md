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

Migracje SQL w `supabase/migrations/` to same pliki - trzeba je osobno zastosować na Supabase.
