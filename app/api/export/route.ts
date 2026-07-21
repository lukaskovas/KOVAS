import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";
import { iterateReport, EXPORT_LIMIT, type Filters } from "@/lib/queries";
import { COLUMNS, type ReportView } from "@/lib/report-columns";
import { csvHeader, csvValue, CSV_BOM, CSV_EOL, CSV_SEP } from "@/lib/csv";
import { setupSheet, sheetOptions, xlsxValue, XLSX_CONTENT_TYPE } from "@/lib/xlsx";

/**
 * Eksport CAŁEGO wyniku po filtrach (nie tylko widocznej strony - to była realna
 * bolączka: Katia eksportowała 100 wierszy zamiast całego raportu).
 *
 * Format wybiera parametr `format`: domyślnie CSV, `format=xlsx` daje plik Excela.
 * Reguły formatu (BOM, separator, przecinek dziesiętny) siedzą w lib/csv.ts, wspólne
 * z eksportem raportów zbiorczych.
 */

const VIEWS: ReportView[] = ["orders", "products", "companies"];

export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const view = (VIEWS.includes(sp.get("view") as ReportView) ? sp.get("view") : "orders") as ReportView;

  const dirParam = sp.get("dir");
  const filters: Filters = {
    q: sp.get("q") ?? undefined,
    from: sp.get("from") ?? undefined,
    to: sp.get("to") ?? undefined,
    status: sp.get("status") ?? undefined,
    currency: sp.get("currency") ?? undefined,
    match: sp.get("match") ?? undefined,
    country: sp.get("country") ?? undefined,
    agent: sp.get("agent") ?? undefined,
    ctype: sp.get("ctype") ?? undefined,
    sort: sp.get("sort") ?? undefined,
    dir: dirParam === "asc" || dirParam === "desc" ? dirParam : undefined,
  };

  const columns = COLUMNS[view];
  const numericTypes = new Set(["money", "number", "percent"]);
  const encoder = new TextEncoder();

  const stamp = new Date().toISOString().slice(0, 10);
  const names: Record<ReportView, string> = { orders: "raport-zamowien", products: "sprzedaz-produktow", companies: "kontrahenci" };

  if (sp.get("format") === "xlsx") {
    return xlsxResponse(view, filters, columns, numericTypes, `${names[view]}-${stamp}.xlsx`);
  }

  // Strumieniowanie zamiast budowania całego pliku w pamięci - przy 89515 pozycjach
  // trzymanie wszystkich wierszy naraz jest niepotrzebnym obciążeniem, a przeglądarka
  // zaczyna pobierać od razu, zamiast czekać na komplet.
  const stream = new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(encoder.encode(CSV_BOM + csvHeader(columns.map((c) => c.header))));
        let written = 0;
        for await (const chunk of iterateReport<{ id: number } & Record<string, unknown>>(view, filters)) {
          const lines = chunk.map((r) => columns.map((c) => csvValue(r[c.key], numericTypes.has(c.type ?? ""))).join(CSV_SEP));
          controller.enqueue(encoder.encode(CSV_EOL + lines.join(CSV_EOL)));
          written += chunk.length;
        }
        // Obcięcie nigdy nie może być ciche - raport bez tej linii wygląda na kompletny
        if (written >= EXPORT_LIMIT) {
          controller.enqueue(encoder.encode(`${CSV_EOL}"UWAGA: eksport obcięty na ${EXPORT_LIMIT} wierszach - zawęź filtry, raport jest NIEKOMPLETNY"`));
        }
        controller.close();
      } catch (e) {
        // Błąd w trakcie strumienia: dopisujemy go do pliku, żeby nie zostać z cichym urwaniem
        controller.enqueue(encoder.encode(`${CSV_EOL}"BŁĄD EKSPORTU - plik jest niekompletny: ${e instanceof Error ? e.message : String(e)}"`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${names[view]}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * XLSX też strumieniowo (WorkbookWriter zapisuje i kompresuje wiersz po wierszu),
 * bo przy limicie 250 000 wierszy budowanie całego skoroszytu w pamięci jest ryzykowne.
 */
function xlsxResponse(
  view: ReportView,
  filters: Filters,
  columns: typeof COLUMNS[ReportView],
  numericTypes: Set<string>,
  filename: string,
): Response {
  const passThrough = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: passThrough, useStyles: true });
  const sheet = workbook.addWorksheet("Raport", sheetOptions(columns.length));

  setupSheet(
    sheet,
    columns.map((c) => ({ header: c.header, numeric: numericTypes.has(c.type ?? "") })),
  );

  void (async () => {
    try {
      let written = 0;
      for await (const chunk of iterateReport<{ id: number } & Record<string, unknown>>(view, filters)) {
        for (const r of chunk) {
          sheet.addRow(columns.map((c) => xlsxValue(r[c.key], numericTypes.has(c.type ?? "")))).commit();
        }
        written += chunk.length;
      }
      // Obcięcie nigdy nie może być ciche - raport bez tej linii wygląda na kompletny
      if (written >= EXPORT_LIMIT) {
        sheet.addRow([`UWAGA: eksport obcięty na ${EXPORT_LIMIT} wierszach - zawęź filtry, raport jest NIEKOMPLETNY`]).commit();
      }
    } catch (e) {
      // Błąd dopisujemy do arkusza, żeby nie zostać z cichym urwaniem w środku pliku
      sheet.addRow([`BŁĄD EKSPORTU - plik jest niekompletny: ${e instanceof Error ? e.message : String(e)}`]).commit();
    } finally {
      await sheet.commit();
      await workbook.commit();
    }
  })();

  return new Response(Readable.toWeb(passThrough) as ReadableStream, {
    headers: {
      "Content-Type": XLSX_CONTENT_TYPE,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
