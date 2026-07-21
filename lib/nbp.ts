import "server-only";

/**
 * Konektor kursów NBP (tabela A - kursy średnie, oficjalne źródło dla przeliczeń księgowych).
 *
 * API: https://api.nbp.pl/api/exchangerates/rates/a/{waluta}/{od}/{do}/?format=json
 * - zwraca TYLKO dni notowań: weekendy i święta nie istnieją (pojedyncza data = HTTP 404),
 *   dlatego zaciągamy ciągły zakres i zapisujemy wszystko, a "kurs z dnia poprzedzającego"
 *   wyliczamy dopiero w SQL jako ostatnie notowanie przed datą zamówienia.
 * - jedno zapytanie obejmuje maksymalnie 367 dni - stąd dzielenie zakresu na kawałki.
 * - bez klucza API i bez limitów wymagających uwierzytelnienia.
 */

const BASE = "https://api.nbp.pl/api/exchangerates/rates/a";
const MAX_DAYS = 360; // z zapasem względem limitu 367 dni

export type NbpRate = { currency: string; effective_date: string; mid: number; table_no: string };

type NbpResponse = { table: string; code: string; rates: { no: string; effectiveDate: string; mid: number }[] };

function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Kursy jednej waluty w zakresie dat (włącznie). Puste tablice dla okresów bez notowań. */
export async function fetchRates(currency: string, from: string, to: string): Promise<NbpRate[]> {
  const code = currency.toLowerCase();
  const out: NbpRate[] = [];

  for (let start = from; start <= to; start = addDays(start, MAX_DAYS + 1)) {
    const end = addDays(start, MAX_DAYS) > to ? to : addDays(start, MAX_DAYS);
    const res = await fetch(`${BASE}/${code}/${start}/${end}/?format=json`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    // 404 = w całym oknie nie ma ani jednego notowania (np. zakres w przyszłości) - to nie błąd
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`NBP ${code} ${start}..${end} -> HTTP ${res.status}`);

    const json = (await res.json()) as NbpResponse;
    for (const r of json.rates) {
      out.push({ currency: currency.toUpperCase(), effective_date: r.effectiveDate, mid: r.mid, table_no: r.no });
    }
  }
  return out;
}
