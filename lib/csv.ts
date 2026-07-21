/**
 * Wspólne formatowanie CSV dla obu eksportów (raporty szczegółowe i zbiorcze).
 *
 * Separator ';' + BOM - Excel w polskiej lokalizacji otwiera plik bez kreatora importu.
 * Liczby z przecinkiem dziesiętnym, żeby Excel widział je jako liczby, a nie tekst.
 */

export const CSV_BOM = "﻿";
export const CSV_SEP = ";";
export const CSV_EOL = "\r\n";

export function csvValue(v: unknown, numeric: boolean, decimals = 2): string {
  if (v === null || v === undefined) return '""';
  if (numeric) {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (!Number.isNaN(n)) return `"${n.toFixed(decimals).replace(".", ",")}"`;
  }
  return `"${String(v).replace(/"/g, '""')}"`;
}

export function csvRow(values: string[]): string {
  return values.join(CSV_SEP);
}

export function csvHeader(headers: string[]): string {
  return csvRow(headers.map((h) => `"${h.replace(/"/g, '""')}"`));
}

/** Nazwa pliku z datą - Katia trzyma eksporty obok siebie i musi je odróżnić. */
export function csvFilename(base: string): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}.csv`;
}
