import Link from "next/link";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { gregorian, omr, parseRange } from "@/lib/format";
import { FilterSelect } from "@/components/FilterSelect";
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

  // filters: booking source, status (only under "all") and order
  const SOURCES = ["direct", "walk_in", "phone", "whatsapp", "booking", "agoda", "expedia", "airbnb", "corporate", "other"];
  const STATUSES = ["tentative", "confirmed", "checked_in", "checked_out", "cancelled", "no_show"];
  const src = typeof sp.src === "string" && SOURCES.includes(sp.src) ? sp.src : "";
  const st = tab === "all" && typeof sp.st === "string" && STATUSES.includes(sp.st) ? sp.st : "";
  const sort = sp.sort === "soon" || sp.sort === "late" || sp.sort === "new" ? sp.sort : tab === "all" ? "late" : "soon";
  // 100 at a time; "show more" raises the count
  const shownMax = Math.min(1000, Math.max(100, Number(sp.n) || 100));

  let query = ctx.supabase
    .from("reservations")
    .select("id, code, stay, status, kind, source, room_total, discount_amount, guests(full_name, phone), units(number)")
    .eq("property_id", ctx.property.id)
    .order(sort === "new" ? "created_at" : "stay", { ascending: sort === "soon" })
    .limit(shownMax + 1);
  if (tab === "upcoming") query = query.in("status", ["tentative", "confirmed"]);
  if (tab === "in_house") query = query.eq("status", "checked_in");
  if (src) query = query.eq("source", src);
  if (st) query = query.eq("status", st);
  // search by code, guest name, phone or unit number
  const s = q.replace(/[%,()]/g, " ").trim();
  if (s) {
    const [{ data: gs }, { data: us }] = await Promise.all([
      ctx.supabase.from("guests").select("id").eq("tenant_id", ctx.tenantId)
        .or(`full_name.ilike.%${s}%,full_name_ar.ilike.%${s}%,phone.ilike.%${s}%`).limit(50),
      ctx.supabase.from("units").select("id").eq("property_id", ctx.property.id).ilike("number", `%${s}%`).limit(50),
    ]);
    const guestIds = ((gs ?? []) as { id: string }[]).map((g) => g.id);
    const unitIds = ((us ?? []) as { id: string }[]).map((u) => u.id);
    query = query.or(
      [
        `code.ilike.%${s}%`,
        ...(guestIds.length ? [`guest_id.in.(${guestIds.join(",")})`] : []),
        ...(unitIds.length ? [`unit_id.in.(${unitIds.join(",")})`] : []),
      ].join(","),
    );
  }
  const { data } = await query;
  const all = (data ?? []) as unknown as Row[];
  const rows = all.slice(0, shownMax);
  const hasMore = all.length > shownMax;

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
        <form className="flex w-full gap-2 sm:ms-auto sm:w-auto">
          <input type="hidden" name="tab" value="all" />
          <input name="q" defaultValue={q} placeholder={`${t.code} / ${t.guest} / ${t.phone} / ${t.unit}`} aria-label={t.search} className="input sm:w-72" />
          <button className="btn-ghost shrink-0">{t.search}</button>
        </form>
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        <input type="hidden" name="tab" value={tab} />
        {q ? <input type="hidden" name="q" value={q} /> : null}
        <FilterSelect name="src" label={t.source} value={src} options={[["", `${t.source}: ${t.fb_all}`], ...SOURCES.map((x): [string, string] => [x, t[`src_${x}` as DictKey]])]} />
        {tab === "all" ? (
          <FilterSelect name="st" label={t.status} value={st} options={[["", `${t.status}: ${t.fb_all}`], ...STATUSES.map((x): [string, string] => [x, t[`rs_${x}` as DictKey]])]} />
        ) : null}
        <FilterSelect name="sort" label={t.sort_soon} value={sort} options={[["soon", t.sort_soon], ["late", t.sort_late], ["new", t.sort_new]]} />
      </form>
      {rows.length === 0 ? (
        q || src || st ? <Empty>{t.none}</Empty> : <Empty action={<Link href="/reservations/new" className="btn-primary">{t.res_new}</Link>}>{t.empty_reservations}</Empty>
      ) : (
        <>
        {/* phones: one card per reservation instead of a wide table */}
        <ul className="grid gap-3 sm:grid-cols-2 md:hidden">
          {rows.map((r) => {
            const st = parseRange(r.stay);
            return (
              <li key={r.id}>
                <Link href={`/reservations/${r.id}`} className="card block">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-bold">{r.guests?.full_name ?? "—"}</div>
                      <div className="text-xs text-muted"><span className="font-semibold text-brand">{r.code}</span> · {t.unit} <span className="num">{r.units?.number}</span></div>
                    </div>
                    <Badge tone={RES_STATUS_TONE[r.status]}><span aria-hidden>{RES_STATUS_EMOJI[r.status]}</span> {t[`rs_${r.status}` as DictKey]}</Badge>
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-2 text-sm">
                    <div className="min-w-0 text-muted">
                      <div>{gregorian(st.from, lang)} – {gregorian(st.to, lang)}</div>
                      <div className="truncate text-xs">{t[`src_${r.source}` as DictKey]}{r.kind === "contract" ? ` · ${t.kind_contract}` : ""}</div>
                    </div>
                    <div className="num shrink-0 font-bold">{omr(r.room_total - r.discount_amount, lang)}</div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
        <div className="card hidden overflow-x-auto p-0 md:block">
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
        {hasMore ? (
          <div className="mt-4 text-center">
            <Link href={`/reservations?tab=${tab}${q ? `&q=${encodeURIComponent(q)}` : ""}${src ? `&src=${src}` : ""}${st ? `&st=${st}` : ""}&sort=${sort}&n=${shownMax + 100}`} scroll={false} className="btn-ghost">{t.show_more}</Link>
          </div>
        ) : null}
        </>
      )}
    </>
  );
}
