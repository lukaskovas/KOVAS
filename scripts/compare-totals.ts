/**
 * Porównanie starej ścieżki sum (getOrderTotals - pełny skan w JS) z nową (report_kpi - agregat SQL).
 * Cel: udowodnić, że podmiana kafelków KPI nie zmieni liczb, ZANIM ją zrobimy.
 * Użycie: npm run compare-totals
 */
import { getOrderTotals, type Filters } from "@/lib/queries";
import { getKpi } from "@/lib/analytics";

const CASES: [string, Filters][] = [
  ["bez filtrów", {}],
  ["waluta PLN", { currency: "PLN" }],
  ["waluta EUR", { currency: "EUR" }],
  ["zakres dat 2025", { from: "2025-01-01", to: "2025-12-31" }],
  ["szukaj 'sp'", { q: "sp" }],
  ["match = matched", { match: "matched" }],
  ["match = ambiguous", { match: "ambiguous" }],
  ["match = unparseable", { match: "unparseable" }],
  ["EUR + 2025 + szukaj", { currency: "EUR", from: "2025-01-01", to: "2025-12-31", q: "sp" }],
];

const near = (a: number, b: number) => Math.abs(a - b) < 0.02;

async function main() {
  for (const [label, f] of CASES) {
    const t0 = Date.now();
    const old = await getOrderTotals(f);
    const tOld = Date.now() - t0;

    const t1 = Date.now();
    const kpi = await getKpi(f);
    const tNew = Date.now() - t1;

    const nw = {
      count: Number(kpi?.orders_count ?? 0),
      net: Number(kpi?.net_pln ?? 0),
      gross: Number(kpi?.gross_pln ?? 0),
      cogs: Number(kpi?.cogs_pln ?? 0),
      margin: Number(kpi?.margin_pln ?? 0),
    };
    const ok =
      old.count === nw.count &&
      near(old.net, nw.net) &&
      near(old.gross, nw.gross) &&
      near(old.cogs, nw.cogs) &&
      near(old.margin, nw.margin);

    console.log(`\n${ok ? "OK     " : "ROZJAZD"}  ${label}   (stara ${tOld}ms / nowa ${tNew}ms)`);
    if (!ok) {
      console.log(`   count : ${old.count} vs ${nw.count}`);
      console.log(`   net   : ${old.net.toFixed(2)} vs ${nw.net.toFixed(2)}`);
      console.log(`   gross : ${old.gross.toFixed(2)} vs ${nw.gross.toFixed(2)}`);
      console.log(`   cogs  : ${old.cogs.toFixed(2)} vs ${nw.cogs.toFixed(2)}`);
      console.log(`   margin: ${old.margin.toFixed(2)} vs ${nw.margin.toFixed(2)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
