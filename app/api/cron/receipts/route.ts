import { NextResponse, type NextRequest } from "next/server";
import { syncGoods, syncReceiptLayers, syncReceiptContractors } from "@/lib/sync/wfirma-costs";
import { syncBrands } from "@/lib/sync/turis";

/**
 * Cron PRZYJĘCIA (koszty zakupu) - raz na dobę (harmonogram w vercel.json). Zasila zakładki
 * ZAKUPY i DOSTAWY, które czytają NA ŻYWO z wfirma_receipt_layers / wfirma_receipt_docs
 * (RPC report_purchases_by_product / report_deliveries) - dlatego NIE wołamy tu refreshReports.
 *
 * Kontekst: wcześniej te dane odświeżał WYŁĄCZNIE ręczny `npm run sync-costs`, więc zakupy potrafiły
 * być nieświeże bez żadnego sygnału w panelu. Przyjęcia (dostawy od dostawców) zmieniają się wolno,
 * więc raz na dobę wystarcza, a jednocześnie nie dokłada presji na współdzielony limit API wFirma.
 *
 * Zakres CELOWO wąski: towary + przyjęcia PW/PZ + dostawcy + marki. NIE robimy tu przeliczenia
 * kosztu własnego (applyCosts) ani mapowania produktów Turis->wFirma - applyCosts dotyka ~90 tys.
 * pozycji zamówień z 10-min statement_timeout i wymaga bezpośredniego połączenia pg, więc nie mieści
 * się w funkcji serverless. Pełny CoGS/marża dalej liczy ręczny `npm run sync-costs`.
 */

// wFirma bywa wolna (backoff na limicie) - pełne 300 s zapasu (plan Pro)
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    // Kolejność jak w skrypcie sync-costs: towary -> przyjęcia -> dostawcy przyjęć -> marki.
    const goods = await syncGoods();
    const receipts = await syncReceiptLayers("cron");
    const suppliers = await syncReceiptContractors();
    const brands = await syncBrands();

    return NextResponse.json({
      ok: true,
      goods,
      receipts,
      suppliers,
      brands,
      totalMs: Date.now() - startedAt,
    });
  } catch (err) {
    // 500, żeby Vercel Cron oznaczył przebieg jako nieudany i było to widać w logach
    return NextResponse.json(
      { ok: false, error: String(err), totalMs: Date.now() - startedAt },
      { status: 500 }
    );
  }
}
