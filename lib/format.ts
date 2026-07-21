/** Formatowanie współdzielone przez server i client components (bez server-only). */

export function fmtMoney(v: unknown, currency?: string | null): string {
  if (v === null || v === undefined || v === "") return "-";
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  if (Number.isNaN(n)) return String(v);
  return `${n.toLocaleString("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? " " + currency : ""}`;
}

export function fmtDate(v: unknown): string {
  if (!v) return "-";
  return String(v).replace("T", " ").slice(0, 16);
}

export function txt(v: unknown): string {
  return v === null || v === undefined || v === "" ? "-" : String(v);
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return "nigdy";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "przed chwilą";
  if (min < 60) return `${min} min temu`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} godz. temu`;
  return `${Math.floor(h / 24)} dni temu`;
}
