import Link from "next/link";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { gregorian, omr, parseRange } from "@/lib/format";
import { Badge, Empty, PageHeader, RES_STATUS_TONE, RES_STATUS_EMOJI } from "@/components/ui";

type Row = {
  id: string; code: string; stay: string; status: string; kind: string; source: string;
  room_total: number; discount_amount: number;
  guests: { full_name: string; phone: string | null } | null;
  units: { number: string } | null;
};

export default async function ReservationsPage({ searchParams }: PageProps<"/reservations">) {
  const ctx = await requireArea("reservations");
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "upcoming";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";

  let query = ctx.supabase
    .from("reservations")
    .select("id, code, stay, status, kind, source, room_total, discount_amount, guests(full_name, phone), units(number)")
    .eq("property_id", ctx.property.id)
    .order("stay", { ascending: tab !== "all" })
    .limit(100);
  if (tab === "upcoming") query = query.in("status", ["tentative", "confirmed"]);
  if (tab === "in_house") query = query.eq("status", "checked_in");
  if (q) query = query.ilike("code", `%${q.replace(/[%,]/g, "")}%`);
  const { data } = await query;
  const rows = (data ?? []) as unknown as Row[];

  const tabs = [
    ["upcoming", t.res_upcoming],
    ["in_house", t.res_in_house],
    ["all", t.res_all],
  ] as const;

  return (
    <>
      <PageHeader title={t.nav_reservations} actions={<Link href="/reservations/new" className="btn-primary">{t.res_new}</Link>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabs.map(([k, label]) => (
          <Link key={k} href={`/reservations?tab=${k}`} className={`btn-sm ${tab === k ? "btn-primary" : "btn-ghost"}`}>{label}</Link>
        ))}
        <form className="ms-auto flex gap-2">
          <input type="hidden" name="tab" value="all" />
          <input name="q" defaultValue={q} placeholder={t.code} className="input w-40" />
          <button className="btn-ghost btn-sm">{t.search}</button>
        </form>
      </div>
      {rows.length === 0 ? (
        <Empty>{t.none}</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr><th>{t.code}</th><th>{t.guest}</th><th>{t.unit}</th><th>{t.from}</th><th>{t.to}</th><th>{t.source}</th><th>{t.total}</th><th>{t.status}</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = parseRange(r.stay);
                return (
                  <tr key={r.id}>
                    <td><Link href={`/reservations/${r.id}`} className="font-semibold text-brand">{r.code}</Link></td>
                    <td>{r.guests?.full_name}</td>
                    <td className="num">{r.units?.number}</td>
                    <td>{gregorian(st.from, lang)}</td>
                    <td>{gregorian(st.to, lang)}</td>
                    <td>{t[`src_${r.source}` as DictKey]}{r.kind === "contract" ? ` · ${t.kind_contract}` : ""}</td>
                    <td className="num">{omr(r.room_total - r.discount_amount, lang)}</td>
                    <td><Badge tone={RES_STATUS_TONE[r.status]}><span aria-hidden>{RES_STATUS_EMOJI[r.status]}</span> {t[`rs_${r.status}` as DictKey]}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
