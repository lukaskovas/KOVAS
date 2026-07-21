/**
 * Wspólne budowanie plików Excela dla obu eksportów (raporty szczegółowe i zbiorcze).
 *
 * Odpowiednik lib/csv.ts. Różnica jest istotna: w XLSX liczby lecą jako prawdziwe liczby
 * z formatem komórki, więc Excel od razu je sumuje - w CSV zawsze zostaje ryzyko, że
 * wpadną jako tekst zależnie od ustawień regionalnych.
 */

import ExcelJS from "exceljs";

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Formaty liczbowe - separator tysięcy i przecinek dziesiętny Excel bierze z lokalizacji użytkownika. */
export const NUM_FMT_INT = "# ##0";
export const NUM_FMT_DEC = "# ##0,00";

export function xlsxFilename(base: string): string {
  return `${base}-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

/** Liczba zostaje liczbą, reszta tekstem. Pusto = pusta komórka, nie "null". */
export function xlsxValue(v: unknown, numeric: boolean | "auto"): number | string | null {
  if (v === null || v === undefined || v === "") return null;
  if (numeric === "auto" ? typeof v === "number" : numeric) {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (!Number.isNaN(n)) return n;
  }
  return String(v);
}

/** `numeric: "auto"` - kolumna mieszana (blok KPI), o typie decyduje wartość komórki. */
export type SheetColumn = { header: string; numeric: boolean | "auto"; decimals?: number };

/**
 * Zamrożenie nagłówka i autofiltr - Katia filtruje i sumuje w Excelu, bez tego robi to ręcznie.
 * Idzie przez opcje addWorksheet, bo w trybie strumieniowym `views` i `autoFilter`
 * są tylko do odczytu po utworzeniu arkusza.
 */
export function sheetOptions(columnCount: number) {
  return {
    views: [{ state: "frozen" as const, ySplit: 1 }],
    autoFilter: { from: { row: 1, column: 1 }, to: { row: 1, column: columnCount } },
  };
}

/** Nagłówek (pogrubiony) i formaty liczbowe kolumn. */
export function setupSheet(sheet: ExcelJS.Worksheet, columns: SheetColumn[]): void {
  // Przez `sheet.columns`, a nie getColumn() - tylko tak szerokości trafiają do pliku
  // w trybie strumieniowym. Kolumny idą przed nagłówkiem, bo nadpisują styl wiersza.
  sheet.columns = columns.map((c) => ({
    width: Math.min(40, Math.max(12, c.header.length + 4)),
    style: c.numeric === true ? { numFmt: c.decimals === 0 ? NUM_FMT_INT : NUM_FMT_DEC, alignment: { horizontal: "right" } } : {},
  }));

  const header = sheet.getRow(1);
  header.values = columns.map((c) => c.header);
  header.font = { bold: true };
  header.alignment = { horizontal: "left" };
  header.commit?.();
}

/** Nazwa arkusza: Excel nie przyjmuje []:*?/\ ani nazw dłuższych niż 31 znaków. */
export function sheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, "-").slice(0, 31) || "Arkusz";
}
