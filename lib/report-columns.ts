/**
 * Definicje kolumn raportów - JEDNO źródło prawdy dla tabeli w UI (app/table-client.tsx)
 * i dla eksportu CSV (app/api/export/route.ts). Wcześniej kolumny żyły tylko w komponencie,
 * przez co eksport i ekran mogły się rozjechać.
 *
 * Kolejność kolumn odwzorowuje raporty EASI (docs/analiza-easi/LUKI-DANYCH.md).
 * `sortKey` = nazwa kolumny w widoku SQL; brak sortKey = kolumna niesortowalna.
 */

export type ColType = "text" | "strong" | "mono" | "money" | "percent" | "date" | "status" | "number";

export type Column = {
  key: string;
  header: string;
  type?: ColType;
  align?: "right";
  grow?: boolean;
  currencyKey?: string;
  sortKey?: string;
  /** Kolumny domyślnie ukryte - dostępne przez przełącznik "Kolumny" i zawsze obecne w eksporcie. */
  optional?: boolean;
};

export type ReportView = "orders" | "products" | "companies";

export const ORDER_COLUMNS: Column[] = [
  { key: "display_order_number", header: "Nr zamówienia", type: "strong", sortKey: "display_order_number" },
  { key: "invoice_fullnumber", header: "Nr faktury", type: "mono", sortKey: "invoice_fullnumber" },
  { key: "company_name", header: "Kontrahent", type: "text", grow: true, sortKey: "company_name" },
  { key: "vat_number", header: "NIP", type: "mono", sortKey: "vat_number" },
  { key: "country_code", header: "Kraj", type: "text", optional: true },
  { key: "country_name", header: "Kraj pochodzenia", type: "text", optional: true },
  // Kolumny z kartoteki EASI (migracja 0011) - w raporcie zamówień EASI stoją w tym samym miejscu.
  // sales_agent, nie agent: "agent" to martwe pole z Turis, puste w 0/10478 zamówień.
  { key: "contractor_type", header: "Typ kontrahenta", type: "text", sortKey: "contractor_type" },
  { key: "sales_agent", header: "Handlowiec", type: "text", sortKey: "sales_agent" },
  { key: "current_status_name", header: "Status", type: "status", sortKey: "current_status_name" },
  { key: "invoice_match_status", header: "Dopasowanie", type: "status", sortKey: "invoice_match_status" },
  { key: "turis_created_at", header: "Data zamówienia", type: "date", sortKey: "turis_created_at" },
  { key: "payment_due_date", header: "Termin płatności", type: "date", sortKey: "payment_due_date" },
  { key: "payment_terms_days", header: "Dni płatności", type: "number", align: "right", sortKey: "payment_terms_days", optional: true },
  { key: "payment_method", header: "Sposób płatności", type: "text", sortKey: "payment_method" },
  { key: "currency_code", header: "Waluta", type: "text", sortKey: "currency_code" },
  { key: "vat_rate", header: "VAT %", type: "percent", align: "right", optional: true },
  { key: "sub_total_price_without_vat", header: "Wartość netto", type: "money", currencyKey: "currency_code", align: "right", sortKey: "sub_total_price_without_vat" },
  { key: "grand_total_price", header: "Wartość brutto", type: "money", currencyKey: "currency_code", align: "right", sortKey: "grand_total_price" },
  { key: "discount_price", header: "Rabat", type: "money", currencyKey: "currency_code", align: "right", sortKey: "discount_price" },
  { key: "vat_price", header: "Kwota VAT", type: "money", currencyKey: "currency_code", align: "right", optional: true },
  { key: "shipping_price", header: "Transport netto", type: "money", currencyKey: "currency_code", align: "right" },
  { key: "shipping_price_gross", header: "Transport brutto", type: "money", currencyKey: "currency_code", align: "right" },
  { key: "products_net", header: "Suma produktów netto", type: "money", currencyKey: "currency_code", align: "right", sortKey: "products_net" },
  { key: "products_gross", header: "Suma produktów brutto", type: "money", currencyKey: "currency_code", align: "right", sortKey: "products_gross" },
  { key: "cogs_total", header: "CoGS", type: "money", currencyKey: "currency_code", align: "right", sortKey: "cogs_total" },
  { key: "margin", header: "Marża", type: "money", currencyKey: "currency_code", align: "right", sortKey: "margin" },
  // Przeliczenia NBP wg kursu z dnia poprzedzającego zamówienie (migracja 0005)
  { key: "rate_pln", header: "Kurs na PLN", type: "number", align: "right", optional: true },
  { key: "net_pln", header: "Wartość netto PLN", type: "money", align: "right", sortKey: "net_pln", optional: true },
  { key: "gross_pln", header: "Wartość brutto PLN", type: "money", align: "right", optional: true },
  { key: "discount_pln", header: "Rabat PLN", type: "money", align: "right", optional: true },
  { key: "vat_pln", header: "Kwota VAT PLN", type: "money", align: "right", optional: true },
  { key: "rate_eur", header: "Kurs na EUR", type: "number", align: "right", optional: true },
  { key: "net_eur", header: "Wartość netto EUR", type: "money", align: "right", sortKey: "net_eur", optional: true },
  { key: "gross_eur", header: "Wartość brutto EUR", type: "money", align: "right", optional: true },
  { key: "discount_eur", header: "Rabat EUR", type: "money", align: "right", optional: true },
  { key: "vat_eur", header: "Kwota VAT EUR", type: "money", align: "right", optional: true },
  { key: "rate_date", header: "Data kursu", type: "date", optional: true },
  { key: "rate_table_no", header: "Tabela NBP", type: "mono", optional: true },
  { key: "invoice_currency_exchange", header: "Kurs (faktura)", type: "number", align: "right", optional: true },
];

export const PRODUCT_COLUMNS: Column[] = [
  { key: "display_order_number", header: "Nr zamówienia", type: "strong", sortKey: "display_order_number" },
  { key: "company_name", header: "Kontrahent", type: "text", grow: true, sortKey: "company_name" },
  { key: "vat_number", header: "NIP", type: "mono", optional: true },
  { key: "country_code", header: "Kraj", type: "text", optional: true },
  { key: "turis_created_at", header: "Data zamówienia", type: "date", sortKey: "turis_created_at" },
  { key: "payment_due_date", header: "Termin płatności", type: "date", optional: true },
  { key: "sku", header: "Kod produktu", type: "mono", sortKey: "sku" },
  { key: "product_name", header: "Nazwa produktu", type: "text", grow: true, sortKey: "product_name" },
  { key: "ean", header: "EAN", type: "mono", optional: true },
  { key: "quantity", header: "Ilość", type: "number", align: "right", sortKey: "quantity" },
  { key: "unit_price_net", header: "Cena netto", type: "money", currencyKey: "currency_code", align: "right", sortKey: "unit_price_net" },
  { key: "unit_price_gross", header: "Cena brutto", type: "money", currencyKey: "currency_code", align: "right", optional: true },
  { key: "total_price_net", header: "Wartość netto", type: "money", currencyKey: "currency_code", align: "right", sortKey: "total_price_net" },
  { key: "total_price_gross", header: "Wartość brutto", type: "money", currencyKey: "currency_code", align: "right", optional: true },
  { key: "vat_amount_per_unit", header: "VAT / szt", type: "money", currencyKey: "currency_code", align: "right", optional: true },
  { key: "vat_rate", header: "VAT %", type: "percent", align: "right", optional: true },
  { key: "currency_code", header: "Waluta", type: "text", optional: true },
  { key: "cogs", header: "CoGS", type: "money", currencyKey: "currency_code", align: "right", sortKey: "cogs" },
];

export const COMPANY_COLUMNS: Column[] = [
  { key: "id", header: "ID", type: "mono", sortKey: "id" },
  { key: "name", header: "Nazwa klienta", type: "strong", grow: true, sortKey: "name" },
  { key: "vat_number", header: "NIP", type: "mono", sortKey: "vat_number" },
  { key: "email", header: "E-mail", type: "text", sortKey: "email" },
  { key: "phone_number", header: "Telefon", type: "text", optional: true },
  { key: "address", header: "Ulica", type: "text", optional: true },
  { key: "zip_code", header: "Kod pocztowy", type: "text", optional: true },
  { key: "city", header: "Miasto", type: "text", sortKey: "city" },
  { key: "country_iso_code", header: "Kod kraju", type: "text", optional: true },
  { key: "country", header: "Kraj pochodzenia", type: "text", sortKey: "country" },
  { key: "contractor_type", header: "Typ kontrahenta", type: "text", sortKey: "contractor_type" },
  { key: "agent", header: "Handlowiec (Opiekun)", type: "text", sortKey: "agent" },
  { key: "discount", header: "Rabat", type: "percent", align: "right", sortKey: "discount" },
  { key: "credit_limit", header: "Limit kredytowy", type: "money", align: "right", optional: true },
];

export const COLUMNS: Record<ReportView, Column[]> = {
  orders: ORDER_COLUMNS,
  products: PRODUCT_COLUMNS,
  companies: COMPANY_COLUMNS,
};

/** Whitelist kolumn sortowalnych - chroni przed wstrzyknięciem dowolnej nazwy w .order(). */
export function sortableKeys(view: ReportView): string[] {
  return COLUMNS[view].map((c) => c.sortKey).filter((k): k is string => Boolean(k));
}
