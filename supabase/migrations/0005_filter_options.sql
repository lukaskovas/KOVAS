-- Listy wartości do filtrów. Wcześniej liczone w JS z próbki `limit 5000` - przy 10k+
-- zamówień próbka nie zawierała rzadkich statusów (Pending, Awaiting Fulfillment) i po
-- prostu nie dało się po nich odfiltrować. Distinct musi iść po całej tabeli, więc robi
-- to baza, a aplikacja czyta gotową listę jednym zapytaniem.
create view v_filter_options as
  select 'status'   as kind, current_status_name as value from orders where current_status_name is not null
  union
  select 'currency', currency_code               from orders   where currency_code is not null
  union
  select 'match',    match_status                from v_invoice_match_quality where match_status is not null
  union
  select 'country',  country                     from companies where country is not null;
