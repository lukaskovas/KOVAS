/**
 * Runner migracji SQL - stosuje pliki z supabase/migrations/*.sql na żywej bazie,
 * jeden raz każdy (śledzone w tabeli _migrations), w kolejności nazw plików.
 * Użycie: npm run migrate
 *
 * Wymaga SUPABASE_DB_URL (connection string z Project Settings -> Database) -
 * to węższe uprawnienie niż Personal Access Token do całego konta Supabase
 * (ten drugi zarządzałby też innymi projektami/billingiem, nie tylko tą bazą).
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const MIGRATIONS_DIR = join(import.meta.dirname, "..", "supabase", "migrations");

async function main() {
  const connectionString = process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    throw new Error("Brak SUPABASE_DB_URL w .env.local (Project Settings -> Database -> Connection string)");
  }

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    await client.query(`
      create table if not exists _migrations (
        filename text primary key,
        applied_at timestamptz not null default now()
      )
    `);

    const { rows: applied } = await client.query<{ filename: string }>("select filename from _migrations");
    const appliedSet = new Set(applied.map((r) => r.filename));

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const pending = files.filter((f) => !appliedSet.has(f));
    if (pending.length === 0) {
      console.log("Brak nowych migracji - baza aktualna.");
      return;
    }

    for (const filename of pending) {
      console.log(`-> ${filename}`);
      const sql = readFileSync(join(MIGRATIONS_DIR, filename), "utf-8");
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into _migrations (filename) values ($1)", [filename]);
        await client.query("commit");
        console.log(`   zastosowana`);
      } catch (err) {
        await client.query("rollback");
        throw new Error(`Migracja ${filename} nie powiodła się (wycofana): ${err}`);
      }
    }
    console.log(`\nGotowe - zastosowano ${pending.length} migracji.`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
