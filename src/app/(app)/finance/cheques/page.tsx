import { Camera } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { addDays, gregorian, omr, parseRange, todayIn } from "@/lib/format";
import { signedUrls } from "@/lib/storage";
import { addCheque, setChequeStatus, updateCheque } from "@/app/actions/money";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { ReceiptInput } from "@/components/FinanceInputs";
import { Badge, EditDetails, Empty, Field, PageHeader, Section, Stat } from "@/components/ui";

type Cheque = {
  id: string; cheque_no: string; bank: string | null; amount: number; due_date: string; status: string; bounce_reason: string | null; notes: string | null;
  reservation_id: string | null; photo_path: string | null;
  reservations: { code: string; units: { number: string } | null; guests: { full_name: string } | null } | null;
};

/** Post-dated cheques: what is due, what is late, what is in the bank, what bounced — and contracts ending soon. */
export default async function ChequesPage() {
  const ctx = await requireArea("finance");
  if (!hasRole(ctx, ["manager", "reception", "accountant"])) redirect("/finance");
  const { t, lang } = await getDict();
  const today = todayIn(ctx.property.timezone);
  const in30 = addDays(today, 30);
  const canOps = hasRole(ctx, ["manager", "accountant"]);
  const [{ data }, { data: active }, { data: ending }] = await Promise.all([
    ctx.supabase.from("cheques")
      .select("id, cheque_no, bank, amount, due_date, status, bounce_reason, notes, reservation_id, photo_path, reservations(code, units(number), guests(full_name))")
      .eq("property_id", ctx.property.id).neq("status", "cancelled").order("due_date").limit(500),
    ctx.supabase.from("reservations").select("id, code, units(number), guests(full_name)").eq("property_id", ctx.property.id)
      .in("status", ["confirmed", "checked_in"]).order("created_at", { ascending: false }).limit(300),
    ctx.supabase.from("reservations").select("id, code, stay, units(number), guests(full_name, phone)").eq("property_id", ctx.property.id)
      .eq("kind", "contract").in("status", ["confirmed", "checked_in"]).order("stay"),
  ]);
  const all = (data ?? []) as unknown as Cheque[];
  const photos = await signedUrls(ctx, "cheque-photos", all.map((c) => c.photo_path));
  const groups = [
    { key: "overdue", title: t.chq_overdue, rows: all.filter((c) => c.status === "pending" && c.due_date < today), tone: "danger" as const },
    { key: "today", title: t.chq_due_today, rows: all.filter((c) => c.status === "pending" && c.due_date === today), tone: "warn" as const },
    { key: "bank", title: t.chq_in_bank, rows: all.filter((c) => c.status === "deposited"), tone: "info" as const },
    { key: "bounced", title: t.chq_bounced_list, rows: all.filter((c) => c.status === "bounced"), tone: "danger" as const },
    { key: "upcoming", title: t.chq_upcoming, rows: all.filter((c) => c.status === "pending" && c.due_date > today && c.due_date <= in30), tone: "gray" as const },
  ];
  const total = (rows: Cheque[]) => rows.reduce((a, c) => a + c.amount, 0);
  const endingSoon = ((ending ?? []) as unknown as { id: string; code: string; stay: string; units: { number: string } | null; guests: { full_name: string; phone: string | null } | null }[])
    .map((r) => ({ ...r, end: parseRange(r.stay).to }))
    .filter((r) => r.end >= today && r.end <= in30);

  const row = (c: Cheque) => (
    <tr key={c.id}>
      <td className="whitespace-nowrap">{gregorian(c.due_date, lang)}</td>
      <td className="num">{c.cheque_no}{c.photo_path && photos.get(c.photo_path) ? <a href={photos.get(c.photo_path)} target="_blank" rel="noreferrer" className="ms-1 inline-flex align-middle text-brand"><Camera className="size-3.5 shrink-0" /></a> : null}</td>
      <td className="text-xs">{c.bank ?? ""}</td>
      <td>
        {c.reservation_id ? (
          <Link href={`/reservations/${c.reservation_id}`} className="text-brand">
            {c.reservations?.guests?.full_name ?? "—"} <span className="text-xs text-muted">{c.reservations?.units?.number}</span>
          </Link>
        ) : "—"}
      </td>
      <td className="num font-semibold">{omr(c.amount, lang)}</td>
      <td>
        <div className="flex flex-wrap gap-1">
          {c.status === "pending" ? (
            <ActionForm action={setChequeStatus}>
              <input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="deposited" />
              <SubmitButton className="btn-ghost btn-sm">{t.chq_deposit}</SubmitButton>
            </ActionForm>
          ) : null}
          {canOps && (c.status === "pending" || c.status === "deposited") ? (
            <ActionForm action={setChequeStatus}>
              <input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="cleared" />
              <SubmitButton className="btn-primary btn-sm" confirm={`${t.chq_clear}?`}>{t.chq_clear}</SubmitButton>
            </ActionForm>
          ) : null}
          {canOps && c.status !== "bounced" ? (
            <details className="text-xs">
              <summary className="cursor-pointer text-danger">{t.chq_bounce}</summary>
              <ActionForm action={setChequeStatus} className="mt-1 flex gap-1">
                <input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="bounced" />
                <input name="reason" placeholder={t.chq_bounce_reason} className="input py-1.5" />
                <SubmitButton className="btn-danger btn-sm">{t.chq_bounce}</SubmitButton>
              </ActionForm>
            </details>
          ) : null}
          {canOps && c.status === "pending" ? (
            <>
              <EditDetails label={t.edit}>
                <ActionForm action={updateCheque} className="grid min-w-64 gap-1.5">
                  <input type="hidden" name="id" value={c.id} />
                  <input name="cheque_no" defaultValue={c.cheque_no} required placeholder={t.chq_no} className="input py-1.5" />
                  <input name="bank" defaultValue={c.bank ?? ""} placeholder={t.chq_bank} className="input py-1.5" />
                  <input name="amount" defaultValue={(c.amount / 1000).toFixed(3)} required inputMode="decimal" aria-label={t.amount} className="input py-1.5" />
                  <input type="date" name="due_date" defaultValue={c.due_date} required aria-label={t.chq_due} className="input py-1.5" />
                  <input name="notes" defaultValue={c.notes ?? ""} placeholder={t.notes} className="input py-1.5" />
                  <SubmitButton className="btn-primary btn-sm">{t.save}</SubmitButton>
                </ActionForm>
              </EditDetails>
              <ActionForm action={setChequeStatus}>
                <input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="cancelled" />
                <SubmitButton className="btn-ghost btn-sm text-danger" confirm={`${t.chq_cancel}?`}>{t.chq_cancel}</SubmitButton>
              </ActionForm>
            </>
          ) : null}
          {canOps && c.status === "bounced" ? (
            <>
              <span className="text-xs text-danger">{c.bounce_reason}</span>
              <ActionForm action={setChequeStatus}>
                <input type="hidden" name="id" value={c.id} /><input type="hidden" name="status" value="cancelled" />
                <SubmitButton className="btn-ghost btn-sm" confirm={`${t.chq_cancel}?`}>{t.chq_cancel}</SubmitButton>
              </ActionForm>
            </>
          ) : null}
        </div>
      </td>
    </tr>
  );

  return (
    <>
      <PageHeader title={t.chq_title} sub={t.chq_hint} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {groups.map((g) => (
          <Stat key={g.key} label={`${g.title} (${g.rows.length})`} value={omr(total(g.rows), lang)} tone={g.rows.length && g.tone !== "gray" ? g.tone : undefined} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {groups.filter((g) => g.rows.length).map((g) => (
            <Section key={g.key} title={g.title}>
              <div className="overflow-x-auto">
                <table className="table">
                  <thead><tr><th>{t.chq_due}</th><th>{t.chq_no}</th><th>{t.chq_bank}</th><th>{t.guest}</th><th>{t.amount}</th><th></th></tr></thead>
                  <tbody>{g.rows.map(row)}</tbody>
                </table>
              </div>
            </Section>
          ))}
          {groups.every((g) => !g.rows.length) ? <Empty>{t.chq_none}</Empty> : null}
        </div>
        <div className="space-y-4">
          <Section title={t.chq_add}>
            <ActionForm action={addCheque} resetOnSuccess className="space-y-2">
              <Field label={t.guest}>
                <select name="res" required className="input">
                  {((active ?? []) as unknown as { id: string; code: string; units: { number: string } | null; guests: { full_name: string } | null }[]).map((r) => (
                    <option key={r.id} value={r.id}>{r.guests?.full_name ?? "—"} · {r.units?.number} · {r.code}</option>
                  ))}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label={t.chq_no}><input name="cheque_no" required className="input" /></Field>
                <Field label={t.chq_bank}><input name="bank" className="input" /></Field>
                <Field label={t.amount}><input name="amount" required inputMode="decimal" className="input" /></Field>
                <Field label={t.chq_due}><input type="date" name="due_date" required defaultValue={today} className="input" /></Field>
              </div>
              <ReceiptInput name="photo" label={t.chq_photo} ready="" />
              <SubmitButton className="btn-primary w-full">{t.chq_add}</SubmitButton>
            </ActionForm>
          </Section>
          <Section title={t.contracts_ending}>
            {endingSoon.length === 0 ? (
              <Empty>{t.none}</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {endingSoon.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <Link href={`/reservations/${r.id}`} className="text-brand">{r.guests?.full_name ?? "—"} · {r.units?.number}</Link>
                    <Badge tone="warn">{gregorian(r.end, lang)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}
