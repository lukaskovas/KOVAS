import "server-only";

/**
 * Konektor do API wFirma (https://api2.wfirma.pl).
 * Autoryzacja: klucze API (accessKey/secretKey/appKey) w nagłówkach - bez OAuth,
 * bez odświeżania tokenów (patrz docs/spotkania/2026-07-20-wms-api/research-wfirma.md).
 * Dokumentacja opisuje find/get jako GET z ciałem XML, ale natywny fetch (Node/Next.js)
 * nie pozwala na body przy GET - jak w praktyce robią to inne kliencki wFirma
 * (np. zmilonas/wfirma-php-api - zawsze CURLOPT_POST), wysyłamy POST dla każdej akcji.
 */

const BASE_URL = "https://api2.wfirma.pl";
const ACCESS_KEY = process.env.WFIRMA_ACCESS_KEY;
const SECRET_KEY = process.env.WFIRMA_SECRET_KEY;
const APP_KEY = process.env.WFIRMA_APP_KEY;
const COMPANY_ID = process.env.WFIRMA_COMPANY_ID;

type WfirmaResponse = { status?: { code?: string } } & Record<string, unknown>;

/**
 * Dedykowany typ błędu dla przerywanego, współdzielonego limitu API wFirma (potwierdzone
 * w logach 2026-07-21 - inna integracja na tym koncie zapycha limit). Warstwa sync łapie
 * TEN konkretny typ osobno (retry z backoffem), a nie każdy błąd wFirma jak crash.
 */
export class WfirmaRateLimitError extends Error {
  constructor(module: string, action: string) {
    super(`wFirma ${module}/${action} -> limit zapytań przekroczony`);
    this.name = "WfirmaRateLimitError";
  }
}

async function wfirmaPost<T extends WfirmaResponse>(module: string, action: string, bodyXml: string): Promise<T> {
  if (!ACCESS_KEY || !SECRET_KEY || !APP_KEY) {
    throw new Error("Brak konfiguracji wFirma (WFIRMA_ACCESS_KEY / WFIRMA_SECRET_KEY / WFIRMA_APP_KEY w .env.local)");
  }
  const url = new URL(`${BASE_URL}/${module}/${action}`);
  url.searchParams.set("inputFormat", "xml");
  url.searchParams.set("outputFormat", "json");
  if (COMPANY_ID) url.searchParams.set("company_id", COMPANY_ID);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      accessKey: ACCESS_KEY,
      secretKey: SECRET_KEY,
      appKey: APP_KEY,
      "Content-Type": "application/xml",
    },
    body: bodyXml,
    cache: "no-store",
  });
  const json = (await res.json()) as T;
  if (json.status?.code?.includes("LIMIT EXCEEDED")) {
    throw new WfirmaRateLimitError(module, action);
  }
  // "NOT FOUND" to pusty wynik, nie awaria - wFirma odpowiada tak m.in. na stronę poza zakresem
  // (trafia się, gdy liczba rekordów jest dokładną wielokrotnością rozmiaru strony).
  // Zwracamy obiekt bez gałęzi danych; unwrapIndexed zrobi z tego pustą listę.
  if (json.status?.code === "NOT FOUND") {
    return json;
  }
  if (!res.ok || json.status?.code !== "OK") {
    throw new Error(`wFirma ${module}/${action} -> HTTP ${res.status}, status ${JSON.stringify(json.status)}`);
  }
  return json;
}

/**
 * wFirma zwraca powtarzalne gałęzie jako obiekt z kluczami liczbowymi ("0","1",...),
 * każdy opakowany jeszcze raz w gałąź o nazwie modułu w liczbie pojedynczej,
 * np. { "0": { "invoice": {...} }, "1": { "invoice": {...} } } - potwierdzone
 * przykładem z dokumentacji (moduł users -> user).
 */
function unwrapIndexed<T>(node: unknown, singularKey: string): T[] {
  if (!node || typeof node !== "object") return [];
  return Object.values(node as Record<string, Record<string, T>>)
    .map((entry) => entry?.[singularKey])
    .filter((v): v is T => v !== undefined);
}

export type Invoice = {
  id: string;
  fullnumber?: string;
  date?: string;
  paymentstate?: string;
  total?: string;
};

export async function getInvoices(limit = 10): Promise<Invoice[]> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<api>
  <invoices>
    <parameters>
      <order><desc>Invoice.id</desc></order>
      <page>1</page>
      <limit>${limit}</limit>
    </parameters>
  </invoices>
</api>`;
  const json = await wfirmaPost<{ invoices?: unknown }>("invoices", "find", body);
  return unwrapIndexed<Invoice>(json.invoices, "invoice");
}

/**
 * Pełne, niezawężone obiekty faktur (do syncu w Supabase - lib/sync/wfirma.ts),
 * stronami rosnąco po Invoice.id (kursor bezpieczny do wznawiania - dokumentacja
 * API nie udostępnia filtra "zmodyfikowano od", patrz research-wfirma.md).
 */
export async function findInvoicesSince(sinceId: number, limit = 100): Promise<Record<string, unknown>[]> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<api>
  <invoices>
    <parameters>
      <conditions>
        <condition>
          <field>id</field>
          <operator>gt</operator>
          <value>${sinceId}</value>
        </condition>
      </conditions>
      <order><asc>Invoice.id</asc></order>
      <page>1</page>
      <limit>${limit}</limit>
    </parameters>
  </invoices>
</api>`;
  const json = await wfirmaPost<{ invoices?: unknown }>("invoices", "find", body);
  return unwrapIndexed<Record<string, unknown>>(json.invoices, "invoice");
}

/** Katalog towarów wFirma - klucz mapowania na produkty Turis (id, name, code, ean). */
export async function findGoodsPage(page: number, limit = 100): Promise<Record<string, unknown>[]> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<api>
  <goods>
    <parameters>
      <order><asc>good.id</asc></order>
      <page>${page}</page>
      <limit>${limit}</limit>
    </parameters>
  </goods>
</api>`;
  const json = await wfirmaPost<{ goods?: unknown }>("goods", "find", body);
  return unwrapIndexed<Record<string, unknown>>(json.goods, "good");
}

/**
 * Dokumenty magazynowe danego typu, RAZEM z pozycjami - `find` zwraca
 * warehouse_document_contents w tej samej odpowiedzi, więc nie potrzeba `get` per dokument.
 *
 * Filtr po typie jest istotny wydajnościowo, nie kosmetycznie: przyjęć (PW+PZ) jest ~46,
 * a wszystkich dokumentów ~2658 (reszta to rezerwacje R i wydania WZ, bez wartości kosztowej).
 * Pełny sweep realnie rozbija się o współdzielony limit API wFirma.
 */
export async function findWarehouseDocsPage(
  type: "PW" | "PZ",
  page: number,
  limit = 100
): Promise<Record<string, unknown>[]> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<api>
  <warehouse_documents>
    <parameters>
      <conditions>
        <condition>
          <field>type</field>
          <operator>eq</operator>
          <value>${type}</value>
        </condition>
      </conditions>
      <order><asc>warehouse_document.id</asc></order>
      <page>${page}</page>
      <limit>${limit}</limit>
    </parameters>
  </warehouse_documents>
</api>`;
  const json = await wfirmaPost<{ warehouse_documents?: unknown }>("warehouse_documents", "find", body);
  return unwrapIndexed<Record<string, unknown>>(json.warehouse_documents, "warehouse_document");
}

/** Pozycje dokumentu magazynowego - ta sama konwencja "obiekt z kluczami liczbowymi". */
export function unwrapDocContents(doc: Record<string, unknown>): Record<string, unknown>[] {
  return unwrapIndexed<Record<string, unknown>>(doc.warehouse_document_contents, "warehouse_document_content");
}

/**
 * Kontrahent wFirma po ID - nazwa dostawcy do raportu dostaw. Nagłówek przyjęcia (PZ) niesie
 * sam `contractor.id`, więc nazwę trzeba dobrać osobno. Pobieramy per ID (dostawców na przyjęciach
 * jest garść), a nie całą bazę kontrahentów - jej rozmiar rozbiłby się o współdzielony limit API.
 * Zwraca listę: [] = nie znaleziono, pierwszy element = trafienie. Rate limit leci wyżej (withRetry).
 */
export async function findContractorById(id: number): Promise<Record<string, unknown>[]> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<api>
  <contractors>
    <parameters>
      <conditions>
        <condition>
          <field>id</field>
          <operator>eq</operator>
          <value>${id}</value>
        </condition>
      </conditions>
      <page>1</page>
      <limit>1</limit>
    </parameters>
  </contractors>
</api>`;
  const json = await wfirmaPost<{ contractors?: unknown }>("contractors", "find", body);
  return unwrapIndexed<Record<string, unknown>>(json.contractors, "contractor");
}
