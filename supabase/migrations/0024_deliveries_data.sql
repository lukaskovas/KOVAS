-- Dane pod Raport dostaw (ruchy magazynowe PZ/PW per dostawa).
-- Pozycje przyjęć już mamy w wfirma_receipt_layers (migracja 0012). Żeby pokazać DOSTAWĘ
-- (nagłówek: dostawca, wartość) i BRAND towaru, brakuje trzech rzeczy, które ta migracja dodaje:
--   1. brands            - marki z Turis (products.brand_id było gołym ID, bez nazwy)
--   2. wfirma_contractors- nazwy dostawców (nagłówek PZ niesie sam contractor.id)
--   3. wfirma_receipt_docs- nagłówki przyjęć (dziś zapisujemy tylko pozycje, nie nagłówek z dostawcą)

-- ============================================================
-- brands (marki z Turis - klucz: products.brand_id)
-- ============================================================
-- products.brand_id (migracja 0001) to liczbowe ID marki z Turis, bez nazwy. Endpoint Turis
-- /brands daje nazwy; bez tej tabeli brand w raporcie byłby tylko numerem.
create table if not exists brands (
  id         bigint primary key,               -- Turis brand.id (= products.brand_id)
  name       text not null,
  raw        jsonb not null,
  synced_at  timestamptz not null default now()
);

-- ============================================================
-- wfirma_contractors (dostawcy z wFirma - klucz: nagłówek przyjęcia contractor.id)
-- ============================================================
-- Osobno od `companies` (to kontrahenci-KLIENCI z Turis) - dostawcy przyjęć to inne podmioty,
-- żyjące po stronie wFirma. Zaciągamy tylko tych, którzy występują na przyjęciach (garść ID).
create table if not exists wfirma_contractors (
  id         bigint primary key,               -- wFirma contractor.id
  name       text not null,
  nip        text,
  raw        jsonb not null,
  synced_at  timestamptz not null default now()
);

-- ============================================================
-- wfirma_receipt_docs (nagłówki przyjęć PW/PZ)
-- ============================================================
-- Pozycje siedzą w wfirma_receipt_layers, ale nagłówka (dostawca, wartość dokumentu) tam nie ma -
-- `raw` warstwy to POZYCJA, nie nagłówek. Trzymamy nagłówek osobno, żeby raport dostaw mógł pokazać
-- kto dostarczył i za ile. Zapełniane w tym samym przebiegu co warstwy (lib/sync/wfirma-costs.ts).
create table if not exists wfirma_receipt_docs (
  doc_id        bigint primary key,            -- wFirma warehouse_document.id
  doc_number    text not null,
  doc_type      text not null,                 -- PW | PZ
  receipt_date  date not null,
  contractor_id bigint,                         -- -> wfirma_contractors.id (bez FK: sync dostawców jest osobnym krokiem)
  netto         numeric,
  brutto        numeric,
  currency      text,
  received      text,                           -- osoba przyjmująca (pole "received" w wFirma)
  raw           jsonb not null,                 -- nagłówek dokumentu BEZ pozycji (te są w warstwach)
  synced_at     timestamptz not null default now()
);
create index if not exists wfirma_receipt_docs_type_date_idx on wfirma_receipt_docs (doc_type, receipt_date);
