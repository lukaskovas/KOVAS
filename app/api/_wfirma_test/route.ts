import { getInvoices } from "@/lib/wfirma";

export async function GET() {
  try {
    const invoices = await getInvoices(5);
    return Response.json({ ok: true, count: invoices.length, invoices });
  } catch (err) {
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
