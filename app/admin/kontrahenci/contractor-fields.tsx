"use client";

/**
 * Wspólny układ pól kontrahenta - dla formularza dodawania i edycji. Wartości jadą przez
 * name= w FormData do server action (actions.ts). Handlowiec i typ kontrahenta mają datalist
 * z istniejącymi wartościami: można wybrać z listy albo wpisać zupełnie nowego (free text),
 * bo dodanie nowego handlowca to jeden z celów panelu.
 */

const inputClass = "mt-1 w-full border-2 border-gold bg-cream px-3 py-2 text-sm outline-none focus:border-plum";
const labelClass = "font-display text-xs font-semibold uppercase tracking-wider text-plum";

export type ContractorValues = {
  name?: string | null;
  vat_number?: string | null;
  email?: string | null;
  phone_number?: string | null;
  address?: string | null;
  zip_code?: string | null;
  city?: string | null;
  country?: string | null;
  country_iso_code?: string | null;
  contractor_type?: string | null;
  agent?: string | null;
  discount?: number | string | null;
  credit_limit?: number | string | null;
};

export default function ContractorFields({
  values = {},
  agents,
  ctypes,
}: {
  values?: ContractorValues;
  agents: string[];
  ctypes: string[];
}) {
  const v = (x: string | number | null | undefined) => (x == null ? "" : String(x));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block sm:col-span-2 lg:col-span-1">
          <span className={labelClass}>Nazwa *</span>
          <input name="name" required defaultValue={v(values.name)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>NIP</span>
          <input name="vat_number" defaultValue={v(values.vat_number)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Typ kontrahenta</span>
          <input name="contractor_type" list="ctype-list" defaultValue={v(values.contractor_type)} className={inputClass} />
        </label>

        <label className="block">
          <span className={labelClass}>Handlowiec (opiekun)</span>
          <input name="agent" list="agent-list" defaultValue={v(values.agent)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>E-mail</span>
          <input type="email" name="email" defaultValue={v(values.email)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Telefon</span>
          <input name="phone_number" defaultValue={v(values.phone_number)} className={inputClass} />
        </label>

        <label className="block">
          <span className={labelClass}>Ulica</span>
          <input name="address" defaultValue={v(values.address)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Kod pocztowy</span>
          <input name="zip_code" defaultValue={v(values.zip_code)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Miasto</span>
          <input name="city" defaultValue={v(values.city)} className={inputClass} />
        </label>

        <label className="block">
          <span className={labelClass}>Kraj</span>
          <input name="country" defaultValue={v(values.country)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Kod kraju (ISO)</span>
          <input name="country_iso_code" maxLength={2} defaultValue={v(values.country_iso_code)} className={inputClass} />
        </label>
        <label className="block">
          <span className={labelClass}>Rabat (%)</span>
          <input type="number" step="0.01" name="discount" defaultValue={v(values.discount)} className={inputClass} />
        </label>

        <label className="block">
          <span className={labelClass}>Limit kredytowy</span>
          <input type="number" step="0.01" name="credit_limit" defaultValue={v(values.credit_limit)} className={inputClass} />
        </label>
      </div>

      <datalist id="agent-list">
        {agents.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
      <datalist id="ctype-list">
        {ctypes.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}
