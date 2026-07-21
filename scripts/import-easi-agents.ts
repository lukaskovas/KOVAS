/**
 * Import przypisań handlowiec -> kontrahent z kartoteki EASI.
 * Użycie: npm run import-agents
 *
 * Źródło: docs/analiza-easi/easi-kontrahenci-handlowcy.csv - zrzut modułu "Kontrahenci"
 * z panelu EASI (1699 rekordów). Turis tych danych nie oddaje przez API, mimo że u siebie
 * je trzyma (patrz nagłówek migracji 0011_agents.sql i LUKI-DANYCH.md sekcja 7.3).
 *
 * Dopasowanie do naszych kontrahentów idzie DWIEMA ścieżkami, w tej kolejności:
 *   1. NIP (same cyfry) - pewny klucz, ale ma go tylko 951 z 1699 rekordów EASI,
 *   2. znormalizowana nazwa (bez znaków niealfanumerycznych, lowercase) - dla pozostałych 748,
 *      czyli osób fizycznych, które w kolumnie NIP mają "-".
 * Która ścieżka zadziałała, zapisujemy w companies.agent_source, żeby dało się później
 * zweryfikować sporne przypisanie bez powtarzania całej analizy.
 *
 * Całe dopasowanie liczy Postgres jednym UPDATE ... FROM. Wersja "pobierz 2050 firm do JS,
 * dopasuj, wyślij 1515 update'ów" robiła to samo kilka minut i po jednym błędzie sieci
 * zostawiała bazę w połowie zaimportowaną.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const CSV = join(import.meta.dirname, "..", "docs", "analiza-easi", "easi-kontrahenci-handlowcy.csv");

/** Parser CSV (RFC 4180): pola w cudzysłowach mogą zawierać separator, nową linię i "" jako znak ". */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) throw new Error("Brak SUPABASE_DB_URL w .env.local");

  const [head, ...body] = parseCsv(readFileSync(CSV, "utf-8"));
  const col = (name: string) => {
    const i = head.indexOf(name);
    if (i < 0) throw new Error(`Brak kolumny "${name}" w ${CSV}`);
    return i;
  };
  const idx = {
    id: col("ID"),
    name: col("Nazwa klienta"),
    nip: col("NIP"),
    type: col("Typ kontrahenta"),
    agent: col("Handlowiec (Opiekun)"),
    country: col("Kod kraju"),
    city: col("Miasto"),
    created: col("Data utworzenia"),
  };

  const rows = body.map((r) => ({
    easi_id: Number(r[idx.id]),
    name: r[idx.name].trim(),
    // W EASI brak NIP-u to "-", nie puste pole. Zapisujemy null, żeby nie udawał klucza.
    nip: r[idx.nip].replace(/\D/g, "") || null,
    contractor_type: r[idx.type].trim() || null,
    agent: r[idx.agent].trim() || null,
    country_code: r[idx.country].trim() || null,
    city: r[idx.city].trim() || null,
    easi_created_at: r[idx.created].trim() || null,
  }));

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query("begin");

    // Pełna podmiana, nie dokładanie: kartoteka EASI to migawka stanu, a kontrahent mógł
    // w niej zmienić opiekuna albo z niej zniknąć.
    await client.query("truncate easi_contractors");
    await client.query(
      `insert into easi_contractors
         (easi_id, name, nip, contractor_type, agent, country_code, city, easi_created_at)
       select * from unnest(
         $1::bigint[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]
       )
       on conflict (easi_id) do update set
         name = excluded.name, nip = excluded.nip,
         contractor_type = excluded.contractor_type, agent = excluded.agent,
         country_code = excluded.country_code, city = excluded.city,
         easi_created_at = excluded.easi_created_at, imported_at = now()`,
      [
        rows.map((r) => r.easi_id), rows.map((r) => r.name), rows.map((r) => r.nip),
        rows.map((r) => r.contractor_type), rows.map((r) => r.agent),
        rows.map((r) => r.country_code), rows.map((r) => r.city), rows.map((r) => r.easi_created_at),
      ],
    );
    console.log(`easi_contractors: ${rows.length} rekordów`);

    // Czyścimy poprzednie przypisania - inaczej kontrahent skreślony w EASI zostałby
    // ze starym opiekunem i nikt by tego nie zauważył.
    await client.query("update companies set agent = null, contractor_type = null, agent_source = null");

    const { rowCount: byNip } = await client.query(`
      update companies c
         set agent = e.agent, contractor_type = e.contractor_type, agent_source = 'nip'
        from easi_contractors e
       where e.nip is not null
         and length(e.nip) >= 7
         and regexp_replace(coalesce(c.vat_number, ''), '\\D', '', 'g') = e.nip`);
    console.log(`dopasowani po NIP:    ${byNip}`);

    const { rowCount: byName } = await client.query(`
      update companies c
         set agent = e.agent, contractor_type = e.contractor_type, agent_source = 'name'
        from easi_contractors e
       where c.agent is null
         and regexp_replace(lower(btrim(c.name)), '[^0-9a-ząćęłńóśźż]', '', 'g')
           = regexp_replace(lower(btrim(e.name)), '[^0-9a-ząćęłńóśźż]', '', 'g')`);
    console.log(`dopasowani po nazwie: ${byName}`);

    const { rows: stat } = await client.query(`
      select
        (select count(*) from companies)                        as firm,
        (select count(*) from companies where agent is not null) as z_agentem,
        (select count(*) from companies c
           where c.agent is null
             and exists (select 1 from orders o where o.company_id = c.id)) as bez_agenta_z_zamowieniami`);
    const s = stat[0];
    console.log(
      `\nkontrahenci: ${s.firm} | z handlowcem: ${s.z_agentem}` +
      ` (${((s.z_agentem / s.firm) * 100).toFixed(1)}%) | bez handlowca, ale z zamówieniami: ${s.bez_agenta_z_zamowieniami}`,
    );

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  }

  // Migawka raportowa trzyma kopię kolumn z companies - bez odświeżenia raporty pokazałyby
  // stan sprzed importu (pusty handlowiec przy każdym zamówieniu).
  console.log("\nodświeżam migawkę raportową...");
  await client.query("select refresh_reports()");
  await client.end();
  console.log("gotowe");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
