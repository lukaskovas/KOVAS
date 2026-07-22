import ExcelJS from "exceljs";
import {
  getDormant,
  getKpi,
  getOrdersBy,
  getProducts,
  getPurchases,
  REPORT_BY_KEY,
  STRUCTURE_BLOCKS,
  STRUCTURE_COLUMNS,
  isPeriod,
  isReportKey,
  type AggColumn,
  type AggRow,
  type AnalyticsFilters,
} from "@/lib/analytics";
import { matchLabel, orderStatusLabel, paymentLabel } from "@/lib/labels";
import { csvHeader, csvValue, csvFilename, CSV_BOM, CSV_EOL, CSV_SEP } from "@/lib/csv";
import { setupSheet, sheetName, sheetOptions, xlsxFilename, xlsxValue, XLSX_CONTENT_TYPE, type SheetColumn } from "@/lib/xlsx";

/**
 * Eksport raportów zbiorczych - dokładnie to, co widać na ekranie /raporty,
 * z tymi samymi filtrami (parametry URL są identyczne).
 * Format wybiera parametr `format`: domyślnie CSV, `format=xlsx` daje plik Excela.
 *
 * Bez strumieniowania, w odróżnieniu od /api/export: raport zbiorczy ma kilkaset,
 * najwyżej kilka tysięcy wierszy, więc plik powstaje w pamięci od razu.
 */

/** Limit twardy funkcji SQL - eksport ma dać komplet, nie TOP N z ekranu. */
const EXPORT_ROWS = 5000;

const NUMERIC = new Set(["money", "number", "share", "change", "days"]);
/** Liczniki i dni są całkowite - "10478,00 zamówień" w Excelu tylko myli. */
const INTEGER = new Set(["number", "days"]);

/**
 * Wspólna reprezentacja wyniku dla obu formatów: surowe wartości + opis kolumn.
 * W CSV bloki idą jeden pod drugim, w XLSX każdy dostaje własny arkusz.
 */
type Block = { title: string; columns: SheetColumn[]; rows: unknown[][] };

function block(title: string, columns: AggColumn[], rows: AggRow[]): Block {
  return {
    title,
    columns: columns.map((c) => ({
      header: c.header,
      numeric: NUMERIC.has(c.type ?? ""),
      decimals: INTEGER.has(c.type ?? "") ? 0 : 2,
    })),
    rows: rows.map((r) => columns.map((c) => (r as Record<string, unknown>)[c.key as string])),
  };
}

function toCsv(blocks: Block[]): string {
  return blocks
    .map((b) => {
      const head = csvHeader(b.columns.map((c) => c.header));
      const body = b.rows.map((row) =>
        row
          .map((v, i) => {
            const c = b.columns[i];
            const numeric = c.numeric === "auto" ? typeof v === "number" : c.numeric;
            const decimals = c.numeric === "auto" ? (Number.isInteger(v) ? 0 : 2) : c.decimals;
            return csvValue(v, numeric, decimals);
          })
          .join(CSV_SEP),
      );
      // Tytuł tylko przy wielu blokach - przy jednym byłby zbędnym wierszem nad nagłówkiem
      const head2 = blocks.length > 1 ? [csvValue(b.title, false), head] : [head];
      return [...head2, ...body].join(CSV_EOL);
    })
    .join(CSV_EOL + CSV_EOL);
}

async function toXlsx(blocks: Block[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  for (const b of blocks) {
    const sheet = workbook.addWorksheet(sheetName(b.title), sheetOptions(b.columns.length));
    setupSheet(sheet, b.columns);
    for (const row of b.rows) {
      sheet.addRow(row.map((v, i) => xlsxValue(v, b.columns[i].numeric)));
    }
  }
  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

function translate(dim: string, rows: AggRow[]): AggRow[] {
  const fn = dim === "status" ? orderStatusLabel : dim === "match" ? matchLabel : dim === "payment" ? paymentLabel : null;
  return fn ? rows.map((r) => ({ ...r, label: fn(r.label) || r.label })) : rows;
}

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const clean = (k: string) => sp.get(k)?.trim() || undefined;
  const xlsx = sp.get("format") === "xlsx";

  const report = isReportKey(sp.get("r") ?? undefined) ? (sp.get("r") as keyof typeof REPORT_BY_KEY) : "podsumowanie";
  const period = isPeriod(sp.get("okres") ?? undefined) ? sp.get("okres")! : "month";
  const days = Math.max(1, Number(sp.get("dni") ?? 90) || 90);

  const dirParam = sp.get("dir");
  const filters: AnalyticsFilters = {
    from: clean("from"),
    to: clean("to"),
    currency: clean("currency"),
    status: clean("status"),
    country: clean("country"),
    agent: clean("agent"),
    ctype: clean("ctype"),
    q: clean("q"),
    sort: clean("sort"),
    dir: dirParam === "asc" || dirParam === "desc" ? dirParam : undefined,
    limit: EXPORT_ROWS,
  };

  const def = REPORT_BY_KEY[report];
  let blocks: Block[];
  let name: string;

  try {
    if (report === "podsumowanie") {
      // Podsumowanie to nie tabela, więc dajemy blok KPI, a obok rozbicie na miesiące
      const [kpi, months] = await Promise.all([getKpi(filters), getOrdersBy("month", { ...filters, sort: undefined, dir: undefined })]);
      const kpiRows: unknown[][] = kpi
        ? [
            ["Przychód netto PLN", kpi.net_pln],
            ["Przychód brutto PLN", kpi.gross_pln],
            // Pole vat_price z Turis jest wypełnione także dla eksportu z odwrotnym obciążeniem,
            // gdzie VAT-u realnie nie naliczono (858 zamówień) - patrz LUKI-DANYCH.md sekcja 8.
            // Ostrzeżenie jedzie w nazwie wskaźnika, bo w Excelu nikt nie zajrzy do dokumentacji.
            ["Kwota VAT PLN (zawyżona - Turis podaje VAT też dla eksportu z odwrotnym obciążeniem)", kpi.vat_pln],
            ["Udzielone rabaty PLN", kpi.discount_pln],
            ["Zamówień", Math.round(Number(kpi.orders_count))],
            ["Średnia wartość zamówienia PLN", kpi.avg_order_pln],
            ["Kontrahentów", Math.round(Number(kpi.companies_count))],
            ["Produktów (SKU)", Math.round(Number(kpi.skus_count))],
            ["Sprzedanych sztuk", Math.round(Number(kpi.items_qty))],
            ["Średnio sztuk na zamówienie", kpi.avg_items_per_order],
            ["Pierwsze zamówienie", kpi.first_order],
            ["Ostatnie zamówienie", kpi.last_order],
          ]
        : [];
      blocks = [
        { title: "Podsumowanie", columns: [{ header: "Wskaźnik", numeric: false }, { header: "Wartość", numeric: "auto" }], rows: kpiRows },
        block("Miesiące", REPORT_BY_KEY.okresy.columns!, months),
      ];
      name = "raport-podsumowanie";
    } else if (report === "struktura") {
      blocks = await Promise.all(
        STRUCTURE_BLOCKS.map(async (b) =>
          block(b.title, STRUCTURE_COLUMNS, translate(b.dim, await getOrdersBy(b.dim, { ...filters, limit: 200 }))),
        ),
      );
      name = "raport-struktura";
    } else if (report === "uspieni") {
      blocks = [block("Uśpieni klienci", def.columns!, await getDormant(days, EXPORT_ROWS, filters.agent))];
      name = `raport-uspieni-klienci-${days}dni`;
    } else if (report === "produkty") {
      blocks = [block("Produkty", def.columns!, await getProducts(filters))];
      name = "raport-produkty";
    } else if (report === "zakupy") {
      blocks = [block("Zakupy", def.columns!, await getPurchases(filters))];
      name = "raport-zakupy";
    } else {
      const dim = report === "okresy" ? period : def.dim!;
      blocks = [block(def.label, def.columns!, translate(dim, await getOrdersBy(dim, filters)))];
      name = report === "okresy" ? `raport-okresy-${period}` : `raport-${report}`;
    }
  } catch (e) {
    // Błąd musi trafić do pliku, a nie zostawić użytkownika z pustym raportem wyglądającym na poprawny
    blocks = [{ title: "Błąd", columns: [{ header: "BŁĄD EKSPORTU", numeric: false }], rows: [[e instanceof Error ? e.message : String(e)]] }];
    name = "raport-blad";
  }

  if (xlsx) {
    return new Response(await toXlsx(blocks), {
      headers: {
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${xlsxFilename(name)}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return new Response(CSV_BOM + toCsv(blocks), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename(name)}"`,
      "Cache-Control": "no-store",
    },
  });
}
