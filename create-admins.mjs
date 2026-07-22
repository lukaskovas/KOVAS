import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

// Wczytaj .env.local (standalone node nie robi tego automatycznie jak Next.js)
const env = {};
for (const line of readFileSync(new URL("./.env.local", import.meta.url)).toString().split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Hasło startowe: 14 bajtów -> ~19 znaków base64url
const genPassword = () => randomBytes(14).toString("base64url");

const emails = ["tomasz@kovas.com", "lukasz@kovas.com"];

for (const email of emails) {
  const password = genPassword();
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    console.log(`BLAD  ${email}: ${error?.message ?? "brak user"}`);
    continue;
  }
  const { error: pErr } = await db.from("profiles").insert({ id: data.user.id, email, role: "admin" });
  if (pErr) {
    await db.auth.admin.deleteUser(data.user.id);
    console.log(`BLAD  ${email} (profiles): ${pErr.message}`);
    continue;
  }
  console.log(`OK    ${email}  |  haslo: ${password}  |  rola: admin`);
}
