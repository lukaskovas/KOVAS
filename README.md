# Kovas · Panel (integrator Turis → wFirma)

Własny odpowiednik systemu EASI - w pełni u siebie, bez n8n.
Stack: **Next.js (Vercel)** + **Supabase** (Postgres) + własne konektory.

Status: **etap 1 gotowy (odczyt)** - Turis i wFirma zsynchronizowane do Supabase, raporty
czytają z bazy (nie live z Turis). Wszystkie trzy blokery danych z analizy EASI są zamknięte:
CoGS (z dokumentów magazynowych wFirma), kursy walut (NBP), handlowiec i typ kontrahenta
(import z kartoteki EASI). Wystawianie faktur to etap 2, jeszcze nie zaczęte.
Otwarte pytania i to, co czeka na potwierdzenie: [docs/OTWARTE-PYTANIA.md](docs/OTWARTE-PYTANIA.md).

## Uruchomienie lokalne
```bash
cp .env.example .env.local   # uzupełnij kluczami Turis / wFirma / Supabase
npm install
npm run migrate              # schemat bazy
npm run preview              # serwer produkcyjny z watchdogiem (preview:stop / preview:status)
```
NIE używać `npm run dev` - Turbopack na tym Macu rozbiega się do 800%+ CPU.
`npm run preview` ubija serwer po 30 min życia i przy CPU >=400%, żeby nie zostawiać pętli w tle.
Serwer zabijać po porcie (`lsof -ti:3000 -sTCP:LISTEN | xargs kill`), **nigdy** `pkill -f next-server`
- to ubija serwery innych projektów.

## Konfiguracja (.env.local)
- `TURIS_BASE_URL`, `TURIS_CLIENT_ID`, `TURIS_CLIENT_SECRET` - panel Turis (OAuth2 client credentials)
- `WFIRMA_ACCESS_KEY`, `WFIRMA_SECRET_KEY`, `WFIRMA_APP_KEY`, `WFIRMA_COMPANY_ID` - panel wFirma (Klucze API)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` - Project Settings -> API (service_role, nie anon)
- `SUPABASE_DB_URL` - Project Settings -> Database -> Connect -> Session pooler (do `npm run migrate`;
  direct connection `db.{ref}.supabase.co` nie działa z tej sieci - rozwiązuje się na IPv6)

Sekrety trzymamy tylko w `.env.local` (poza repo) / env Vercela. Nigdy we frontendzie.

## Synchronizacja danych - kolejność
```bash
npm run backfill         # Turis (kontrahenci, produkty, zamówienia, pozycje) + faktury wFirma + matcher
npm run sync-fx          # kursy NBP (tabela A, EUR i USD) do fx_rates
npm run sync-costs       # towary i dokumenty przyjęć wFirma -> warstwy kosztowe (CoGS)
npm run import-agents    # handlowiec + typ kontrahenta z kartoteki EASI (zrzut CSV w docs/)
npm run refresh-reports  # przelicza migawkę mv_report_orders - BEZ TEGO RAPORTY POKAZUJĄ STARY STAN
```
`npm run backfill` odświeża migawkę sam na koniec. Pozostałe skrypty nie - po nich uruchom
`refresh-reports` ręcznie.

## Struktura
- `lib/turis.ts`, `lib/wfirma.ts` - konektory API (token/klucze, fetch, tylko server-side)
- `lib/nbp.ts` - kursy NBP (tabela A)
- `lib/supabase.ts` - klient Supabase (service_role) + `fetchAll()` (PostgREST domyślnie ucina
  niepaginowane zapytania do 1000 wierszy - użyj tego zamiast gołego `.select()` dla pełnych zbiorów)
- `lib/sync/` - synchronizacja Turis/wFirma -> Supabase, matcher zamówień z fakturami,
  `wfirma-costs.ts` (warstwy przyjęć = źródło CoGS), `refresh-reports.ts`
- `lib/queries.ts` - stronicowane zapytania raportowe pod UI (wyszukiwanie i sortowanie serwerowe)
- `lib/analytics.ts` - raporty zbiorcze (agregaty liczone w bazie, funkcje z migracji 0007-0009)
- `lib/report-columns.ts` - jedno źródło definicji kolumn dla ekranu i eksportu
- `lib/csv.ts`, `lib/xlsx.ts` - wspólne formatowanie obu formatów eksportu
- `scripts/migrate.ts` (`npm run migrate`) - runner migracji SQL z `supabase/migrations/`
- `scripts/backfill.ts` (`npm run backfill`) - jednorazowy pełny backfill (nie Vercel Cron - za długo)
- `scripts/compare-totals.ts` (`npm run compare-totals`) - porównuje starą ścieżkę sum (JS)
  z agregatem SQL; użyty przy migracjach 0008/0009, zostaje jako test regresji
- `app/page.tsx` + `app/view-data.tsx` - panel: Raport zamówień / Sprzedaż produktów / Kontrahenci
- `app/raporty/` + `app/analytics-view.tsx` - zakładka Raporty: podsumowanie, kontrahenci, produkty,
  okresy, kraje, struktura, handlowcy, uśpieni klienci (każdy z filtrami i eksportem)
- `app/api/export`, `app/api/export-report` - eksport CAŁEGO wyniku po filtrach (CSV lub `?format=xlsx`)
- `docs/analiza-easi/` - analiza EASI, mapowanie kolumn i luk, decyzje architektoniczne, mapa API Turis
- `docs/research/` - standard raportowy branży (NotebookLM) i kandydaci na kolejne raporty
- `docs/spotkania/` - notatki ze spotkań i research (Sellasist, wFirma, WMS)

## Jak liczymy - reguły przyjęte i udokumentowane
- **CoGS**: cena jednostkowa z **pierwszego przyjęcia** towaru w wFirma (`v_good_unit_cost`) - tak
  liczy dziś EASI, dlatego liczby zgadzają się co do grosza (zam. 11098: 533,30 zł). Baza trzyma
  WARSTWY przyjęć, więc zmiana metody na średnią ważoną kroczącą = podmiana jednego widoku,
  bez ponownego syncu. **Metoda docelowa czeka na decyzję Łukasza** - patrz OTWARTE-PYTANIA.
- **Kursy**: NBP tabela A z dnia poprzedzającego zamówienie (weekend -> ostatnie notowanie przed datą).
  Kwoty w PLN zgadzają się z EASI, EUR się różni - EASI stosuje jeden bieżący kurs do całego raportu.
- **Handlowiec i typ kontrahenta**: atrybut KONTRAHENTA (tak samo jak w EASI), zaimportowany
  jednorazowo z kartoteki EASI. 1515/2050 kontrahentów, 99,86% wartości sprzedaży.
- **VAT**: `vat_price` z Turis jest wypełnione także przy odwrotnym obciążeniu (858 zamówień
  eksportowych), więc suma tej kolumny zawyża podatek. Dlatego VAT nie jest kafelkiem KPI,
  a w eksporcie ma ostrzeżenie w nazwie.
- **Nie odtwarzamy błędu EASI**: w raporcie produktów EASI liczy brutto jako netto × 1,23², my liczymy
  poprawnie - kolumny cen brutto i VAT będą się tam różnić od EASI.

## Raporty zbiorcze - jak to liczy
Agregaty liczy Postgres (funkcje `report_*` z migracji 0007-0009), nie aplikacja:
PostgREST oddaje maksymalnie 1000 wierszy, więc sumowanie w JS dawałoby wynik z próbki.

Podstawą jest **migawka `mv_report_orders`** - spłaszczony `v_orders_report` (ten widok ma lateral
joiny do kursów i faktur oraz nieskorelowaną agregację pozycji; jego przeliczanie przy każdym
raporcie przekraczało limit czasu API). Od migracji 0010 z migawki czyta też lista zamówień -
strona `/?view=orders` spadła z ~12 s do ułamka sekundy. Konsekwencja: ekran pokazuje stan
z ostatniego odświeżenia migawki, nie stan tabel na żywo.

Wszystkie kwoty w raportach zbiorczych są w PLN (kurs NBP z dnia poprzedzającego zamówienie) -
sumowanie kolumn w walucie zamówienia mieszałoby złotówki z euro.

## Dalej
- Krok 6: webhooki Turis + Vercel Cron (nocna synchronizacja) - wymaga wdrożenia na Vercel
- Backupy (warunek Łukasza): backup Supabase + cykliczny eksport na Google Drive
- Etap 2: wystawianie faktur do wFirma (dopiero po weryfikacji zgodności danych z EASI)
- Weryfikacja kontrahentów po NIP (CEIDG/KRS/GUS)
- Pełna lista otwartych tematów: [docs/OTWARTE-PYTANIA.md](docs/OTWARTE-PYTANIA.md)
- Do sprzątnięcia ręcznie (nie kasuję plików bez zgody): `app/api/_wfirma_test/`,
  `scripts/_debug-check.ts`, `scripts/_tmp-*`, `scripts/_probe-*`, `scripts/_fetch-wfirma-*`,
  `scripts/_seed-costs-from-json.ts` - pomocnicze pliki z sesji deweloperskich.
  `scripts/_analyze-wfirma-cost.ts` warto zostawić: to nim odtworzono metodę kosztu EASI.
