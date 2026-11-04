import { CreditCard } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { gregorian, parseRange } from "@/lib/format";
import { convertChannelBlock } from "@/app/actions/channels";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Crumb, PageHeader, Section } from "@/components/ui";

/** Turn nights sold on a channel into a real booking: pick (or register) the guest, then confirm. */
export default async function ConvertBlockPage({ params, searchParams }: PageProps<"/channels/convert/[id]">) {
  const ctx = await requireArea("reservations");
  if (!hasRole(ctx, ["manager", "reception"])) notFound();
  const { t, lang } = await getDict();
  const { id } = await params;
  const sp = await searchParams;
  const { data: b } = await ctx.supabase.from("channel_blocks").select("id, stay, summary, reservation_id, removed_at, units(number), ical_feeds(channel)").eq("id", id).maybeSingle();
  if (!b) notFound();
  const stay = parseRange(b.stay as string);
  const ch = (b.ical_feeds as unknown as { channel: string } | null)?.channel ?? "other";
  const guestId = typeof sp.guest === "string" ? sp.guest : "";
  const gq = typeof sp.gq === "string" ? sp.gq : "";
  const clean = gq.replace(/[%,()]/g, " ");
  const [{ data: guest }, { data: results }] = await Promise.all([
    guestId ? ctx.supabase.from("guests").select("id, full_name, phone, doc_number").eq("id", guestId).maybeSingle() : Promise.resolve({ data: null }),
    gq ? ctx.supabase.from("guests").select("id, full_name, phone").or(`full_name.ilike.%${clean}%,phone.ilike.%${clean}%,doc_number.ilike.%${clean}%`).limit(8) : Promise.resolve({ data: [] }),
  ]);
  const here = `/channels/convert/${id}`;

  return (
    <>
      <Crumb href="/channels" label={t.ch_title} />
      <PageHeader title={t.ch_convert} sub={`${t[`src_${ch}` as DictKey]} · ${t.unit} ${(b.units as unknown as { number: string } | null)?.number} · ${gregorian(stay.from, lang)} → ${gregorian(stay.to, lang)}`} />
      {b.reservation_id ? (
        <Link href={`/reservations/${b.reservation_id}`} className="btn-primary">{t.ch_already}</Link>
      ) : b.removed_at ? (
        <p className="card text-sm text-muted">{t.ch_removed}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t.guest}>
            {guest ? (
              <div className="rounded-xl bg-surface-2 p-3 text-sm">
                <div className="font-semibold">{guest.full_name}</div>
                <div dir="ltr" className="text-xs text-muted">{guest.phone} {guest.doc_number}</div>
                <Link href={here} className="text-xs text-brand">{t.edit}</Link>
              </div>
            ) : (
              <>
                <form className="flex gap-2">
                  <input name="gq" defaultValue={gq} placeholder={`${t.name} / ${t.phone} / ${t.doc_number}`} className="input" />
                  <button className="btn-ghost btn-sm">{t.search}</button>
                </form>
                <ul className="mt-2 divide-y divide-line">
                  {(results ?? []).map((g) => (
                    <li key={g.id}><Link href={`${here}?guest=${g.id}`} className="flex justify-between py-2 text-sm"><span>{g.full_name}</span><span dir="ltr" className="text-muted">{g.phone}</span></Link></li>
                  ))}
                </ul>
                <Link href={`/guests/new?read=1&next=${encodeURIComponent(here)}`} className="btn-primary mt-3 inline-flex w-full items-center justify-center gap-2">
                  <CreditCard className="size-4 shrink-0" />{t.rd_register}
                </Link>
                <Link href={`/guests/new?next=${encodeURIComponent(here)}`} className="btn-ghost mt-2 w-full">+ {t.res_new_guest}</Link>
              </>
            )}
          </Section>
          {guest ? (
            <Section title={t.res_confirm}>
              <p className="mb-3 text-sm text-muted">{t.ch_convert_hint}</p>
              <ActionForm action={convertChannelBlock}>
                <input type="hidden" name="block" value={b.id} />
                <input type="hidden" name="guest" value={guest.id} />
                <SubmitButton className="btn-primary w-full">{t.ch_convert}</SubmitButton>
              </ActionForm>
            </Section>
          ) : null}
        </div>
      )}
    </>
  );
}
