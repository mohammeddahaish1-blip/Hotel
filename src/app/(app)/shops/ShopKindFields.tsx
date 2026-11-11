"use client";

import { useState } from "react";

/** Shop type and activity; a rented shop also asks for the renter, the rent and the contract dates. */
export function ShopKindFields({ t, categories }: {
  t: { kind: string; service: string; rental: string; category: string; renterName: string; renterPhone: string; rent: string; start: string; end: string };
  categories: { value: string; label: string }[];
}) {
  const [kind, setKind] = useState<"service" | "rental">("service");
  return (
    <>
      <fieldset>
        <legend className="label">{t.kind}</legend>
        <div className="grid gap-1.5">
          {(["service", "rental"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/50">
              <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} />
              {k === "service" ? t.service : t.rental}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="label">{t.category}</span>
        <select name="category" defaultValue={kind === "rental" ? "office" : "laundry"} key={kind} className="input">
          {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </label>
      {kind === "rental" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block sm:col-span-2"><span className="label">{t.renterName}</span><input name="renter_name" maxLength={120} className="input" /></label>
          <label className="block"><span className="label">{t.renterPhone}</span><input name="renter_phone" dir="ltr" inputMode="tel" maxLength={30} className="input" /></label>
          <label className="block"><span className="label">{t.rent}</span><input name="monthly_rent" inputMode="decimal" dir="ltr" placeholder="0.000" className="input" /></label>
          <label className="block"><span className="label">{t.start}</span><input name="contract_start" type="date" className="input" /></label>
          <label className="block"><span className="label">{t.end}</span><input name="contract_end" type="date" className="input" /></label>
        </div>
      ) : null}
    </>
  );
}
