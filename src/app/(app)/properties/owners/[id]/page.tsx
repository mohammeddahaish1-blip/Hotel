import { notFound, redirect } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { dictionaries, type DictKey } from "@/lib/i18n/dict";
import { gregorian, omr, todayIn } from "@/lib/format";
import { assignUnits, recordPayout, updateOwner } from "@/app/actions/owners";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PrintButton } from "@/components/PrintButton";
import { Crumb, Field, PageHeader, Section } from "@/components/ui";

type Statement = {
  owner: { id: string; name: string; phone: string | null; commission_bp: number; language: "ar" | "en" };
  from: string; to: string; opening: number; revenue: number; commission: number; expenses: number; payouts: number; closing: number;
  units: { id: string; number: string; revenue: number; expenses: number }[];
  expense_lines: { date: string; unit: string; description: string; category: string; amount: number }[];
  payout_lines: { date: string; amount: number; method: string; reference: string | null }[];
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function OwnerPage({ params, searchParams }: PageProps<"/properties/owners/[id]">) {
  const ctx = await requireArea("board");
  if (!hasRole(ctx, ["manager", "accountant"])) redirect("/properties");
  const { t } = await getDict();
  const { id } = await params;
  const sp = await searchParams;
  const today = todayIn(ctx.property.timezone);
  const from = typeof sp.from === "string" && DATE.test(sp.from) ? sp.from : `${today.slice(0, 8)}01`;
  const to = typeof sp.to === "string" && DATE.test(sp.to) ? sp.to : today;

  const [{ data: owner }, { data: st, error }, { data: units }] = await Promise.all([
    ctx.supabase.from("unit_owners").select("*").eq("id", id).maybeSingle(),
    ctx.supabase.rpc("owner_statement", { p_owner: id, p_from: from, p_to: to }),
    ctx.supabase.from("units").select("id, number, owner_id").eq("property_id", ctx.property.id).eq("active", true).order("number"),
  ]);
  if (!owner || error) notFound();
  const s = st as Statement;
  // The statement itself is printed in the owner's language
  const d = dictionaries[s.owner.language];
  const L = s.owner.language;
  const canEdit = hasRole(ctx, ["manager"]);
  const rows: [DictKey, number, string?][] = [
    ["own_opening", s.opening],
    ["own_revenue", s.revenue, "text-ok"],
    ["own_commission_amt", -s.commission],
    ["own_expenses", -s.expenses],
    ["own_payouts", -s.payouts],
  ];

  return (
    <>
      <Crumb href="/properties/owners" label={t.nav_owners} />
      <PageHeader title={owner.name} sub={`${t.own_commission}: ${owner.commission_bp / 100}%`} actions={<PrintButton label={t.print} />} />

      <form method="get" className="no-print card mb-4 flex flex-wrap items-end gap-2">
        <label className="text-xs text-muted">{t.from}<input type="date" name="from" defaultValue={from} className="input mt-1" /></label>
        <label className="text-xs text-muted">{t.to}<input type="date" name="to" defaultValue={to} className="input mt-1" /></label>
        <button className="btn-primary btn-sm">{t.run}</button>
      </form>

      <article className="card mx-auto mb-4 max-w-3xl p-6" dir={L === "en" ? "ltr" : "rtl"} lang={L}>
        <header className="mb-4 flex items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <h2 className="text-xl font-bold">{d.own_statement}</h2>
            <div className="text-sm">{s.owner.name}</div>
            <div className="text-xs text-muted">{gregorian(s.from, L)} – {gregorian(s.to, L)}</div>
          </div>
          <div className="text-end text-sm">
            <div className="font-bold">{L === "en" && ctx.property.name_en ? ctx.property.name_en : ctx.property.name_ar}</div>
            <div className="brand-word text-2xl text-brand">نُزُل</div>
          </div>
        </header>
        <table className="table mb-4">
          <tbody>
            {rows.map(([k, v, c]) => (
              <tr key={k}><td>{d[k]}{k === "own_commission_amt" ? ` (${s.owner.commission_bp / 100}%)` : ""}</td><td className={`num text-end ${c ?? ""}`}>{omr(v, L)}</td></tr>
            ))}
            <tr className="font-bold"><td>{d.own_closing}</td><td className={`num text-end ${s.closing < 0 ? "text-danger" : "text-brand"}`}>{omr(s.closing, L)}</td></tr>
          </tbody>
        </table>
        {s.units.length ? (
          <>
            <h3 className="mb-1 font-semibold">{d.own_units}</h3>
            <table className="table mb-4">
              <thead><tr><th>{d.unit}</th><th>{d.own_revenue}</th><th>{d.own_expenses}</th></tr></thead>
              <tbody>{s.units.map((u) => <tr key={u.id}><td className="num">{u.number}</td><td className="num">{omr(u.revenue, L)}</td><td className="num">{omr(u.expenses, L)}</td></tr>)}</tbody>
            </table>
          </>
        ) : null}
        {s.expense_lines.length ? (
          <>
            <h3 className="mb-1 font-semibold">{d.own_expenses}</h3>
            <table className="table mb-4">
              <tbody>{s.expense_lines.map((e, i) => (
                <tr key={i}><td className="text-xs">{gregorian(e.date, L)}</td><td className="num text-xs">{e.unit}</td><td>{e.description} <span className="text-xs text-muted">{d[`ec_${e.category}` as DictKey]}</span></td><td className="num text-end">{omr(e.amount, L)}</td></tr>
              ))}</tbody>
            </table>
          </>
        ) : null}
        {s.payout_lines.length ? (
          <>
            <h3 className="mb-1 font-semibold">{d.own_payouts}</h3>
            <table className="table">
              <tbody>{s.payout_lines.map((p, i) => (
                <tr key={i}><td className="text-xs">{gregorian(p.date, L)}</td><td className="text-xs">{d[`pm_${p.method}` as DictKey]} {p.reference ?? ""}</td><td className="num text-end">{omr(p.amount, L)}</td></tr>
              ))}</tbody>
            </table>
          </>
        ) : null}
      </article>

      <div className="no-print grid gap-4 lg:grid-cols-3">
        <Section title={t.own_pay}>
          <ActionForm action={recordPayout} resetOnSuccess className="space-y-2">
            <input type="hidden" name="id" value={id} />
            <Field label={t.amount}><input name="amount" required inputMode="decimal" defaultValue={s.closing > 0 ? (s.closing / 1000).toFixed(3) : ""} className="input" /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t.date}><input type="date" name="paid_on" required defaultValue={today} className="input" /></Field>
              <Field label={t.method}>
                <select name="method" defaultValue="transfer" className="input">
                  {["transfer", "cash", "card"].map((m) => <option key={m} value={m}>{t[`pm_${m}` as DictKey]}</option>)}
                </select>
              </Field>
            </div>
            <Field label={t.reference}><input name="reference" className="input" /></Field>
            <SubmitButton className="btn-primary w-full" confirm={`${t.own_pay}?`}>{t.own_pay}</SubmitButton>
          </ActionForm>
        </Section>
        {canEdit ? (
          <Section title={t.own_assign}>
            <ActionForm action={assignUnits} className="space-y-2">
              <input type="hidden" name="id" value={id} />
              <div className="grid max-h-64 grid-cols-3 gap-1.5 overflow-y-auto">
                {(units ?? []).filter((u) => !u.owner_id || u.owner_id === id).map((u) => (
                  <label key={u.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/50">
                    <input type="checkbox" name="units" value={u.id} defaultChecked={u.owner_id === id} /> <span className="num">{u.number}</span>
                  </label>
                ))}
              </div>
              <SubmitButton className="btn-primary w-full">{t.save}</SubmitButton>
            </ActionForm>
          </Section>
        ) : null}
        {canEdit ? (
          <Section title={t.edit}>
            <ActionForm action={updateOwner} className="space-y-2">
              <input type="hidden" name="id" value={id} />
              <Field label={t.own_name}><input name="name" defaultValue={owner.name} required className="input" /></Field>
              <Field label={t.phone}><input name="phone" defaultValue={owner.phone ?? ""} dir="ltr" className="input" /></Field>
              <Field label={t.email}><input name="email" defaultValue={owner.email ?? ""} dir="ltr" className="input" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t.own_commission}><input name="commission" defaultValue={owner.commission_bp / 100} inputMode="decimal" className="input" /></Field>
                <Field label={t.own_lang}>
                  <select name="language" defaultValue={owner.language} className="input"><option value="ar">العربية</option><option value="en">English</option></select>
                </Field>
              </div>
              <SubmitButton className="btn-ghost w-full">{t.save}</SubmitButton>
            </ActionForm>
          </Section>
        ) : null}
      </div>
    </>
  );
}
