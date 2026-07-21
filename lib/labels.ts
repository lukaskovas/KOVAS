/**
 * Polskie etykiety dla wartości technicznych trzymanych w bazie.
 *
 * Same wartości MUSZĄ zostać angielskie - to klucze filtrów w URL-u, w zapytaniach
 * do Supabase i w eksporcie CSV. Tłumaczymy tylko to, co widzi użytkownik.
 * Nieznana wartość wraca surowa (Turis może dorzucić nowy status w każdej chwili).
 */

/** Status dopasowania faktura <-> zamówienie - nasz własny (lib/sync/match-invoices.ts). */
const MATCH: Record<string, string> = {
  matched: "dopasowane",
  ambiguous: "niejednoznaczne",
  unparseable: "brak nr zamówienia",
  unmatched_no_order: "brak zamówienia",
  pending: "oczekuje",
};

/** Status zamówienia - wartości pochodzą z Turis. */
const ORDER_STATUS: Record<string, string> = {
  pending: "oczekuje",
  processing: "w realizacji",
  completing: "kompletowane",
  "awaiting fulfillment": "oczekuje na realizację",
  "awaiting payment": "oczekuje na płatność",
  "awaiting shipment": "oczekuje na wysyłkę",
  shipped: "wysłane",
  completed: "zrealizowane",
  complete: "zrealizowane",
  cancelled: "anulowane",
  canceled: "anulowane",
  refunded: "zwrócone",
  declined: "odrzucone",
};

/** Sposób płatności - wyliczany z payment_terms w widoku v_orders_report, nie z Turis wprost. */
const PAYMENT: Record<string, string> = {
  cod: "przy odbiorze",
  transfer: "przelew",
};

const lookup = (map: Record<string, string>, v: string | null | undefined) =>
  v ? map[v.toLowerCase().trim()] ?? v : "";

export const matchLabel = (v: string | null | undefined) => lookup(MATCH, v);
export const orderStatusLabel = (v: string | null | undefined) => lookup(ORDER_STATUS, v);
export const paymentLabel = (v: string | null | undefined) => lookup(PAYMENT, v);
