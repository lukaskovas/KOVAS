-- Pola płatności faktur wFirma (pod "automatyczne rozliczanie płatności" - lista życzeń Katii).
-- wFirma zwraca je w tym samym invoices/find, które już zaciągamy (potwierdzone na żywym API
-- 2026-07-22): paymentstate/paymentdate/remaining/alreadypaid/paymentmethod. paymentstate już
-- jest kolumną od 0001; tu dokładamy resztę, żeby rozrachunki (zapłacone/przeterminowane, aging)
-- dało się liczyć w SQL bez rozpakowywania raw. Dane i tak siedzą w raw - to tylko wystawienie.

alter table invoices
  add column payment_method   text,      -- transfer / cash / ... (wFirma paymentmethod)
  add column payment_due_date date,      -- termin płatności (wFirma paymentdate)
  add column amount_paid      numeric,   -- ile już zapłacono (wFirma alreadypaid)
  add column amount_remaining numeric;   -- ile zostało do zapłaty (wFirma remaining)
