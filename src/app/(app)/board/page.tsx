import Link from "next/link";
import { requireArea, can } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { gregorian } from "@/lib/format";
import { Badge, Empty, PageHeader, UNIT_STATUS_TONE } from "@/components/ui";

type Row = {
  unit_id: string;
  number: string;
  floor_name: string | null;
  type_name: string;
  status: string;
  reservation_id: string | null;
  guest_name: string | null;
  departure: string | null;
  next_arrival: string | null;
};

export default async function BoardPage({ searchParams }: PageProps<"/board">) {
  const ctx = await requireArea("board");
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const filter = typeof sp.status === "string" ? sp.status : null;
  const { data, error } = await ctx.supabase.rpc("unit_board", { p_property: ctx.property.id });
  if (error) throw new Error(error.message);
  const rows = (data as Row[]).filter((r) => !filter || r.status === filter);
  const floors = [...new Set(rows.map((r) => r.floor_name ?? "—"))];
  const statuses = ["available", "reserved", "occupied", "dirty", "maintenance", "out_of_service"];
  const canBook = can(ctx.role, "reservations") && ctx.role !== "accountant";

  return (
    <>
      <PageHeader
        title={t.nav_board}
        actions={canBook ? <Link href="/reservations/new" className="btn-primary">{t.res_new}</Link> : null}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/board" className={`btn-sm ${!filter ? "btn-primary" : "btn-ghost"}`}>{t.units}</Link>
        {statuses.map((s) => (
          <Link key={s} href={`/board?status=${s}`} className={`btn-sm ${filter === s ? "btn-primary" : "btn-ghost"}`}>
            {t[`st_${s}` as DictKey]}
          </Link>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>{t.none}</Empty>
      ) : (
        floors.map((f) => (
          <div key={f} className="mb-5">
            <div className="mb-2 text-xs font-semibold text-muted">{t.floor}: {f}</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {rows
                .filter((r) => (r.floor_name ?? "—") === f)
                .map((r) => {
                  const body = (
                    <div className="card h-full p-3">
                      <div className="flex items-center justify-between">
                        <span className="num text-lg font-bold">{r.number}</span>
                        <Badge tone={UNIT_STATUS_TONE[r.status]}>{t[`st_${r.status}` as DictKey]}</Badge>
                      </div>
                      <div className="mt-1 truncate text-xs text-muted">{r.type_name}</div>
                      {r.guest_name ? <div className="mt-2 truncate text-sm">{r.guest_name}</div> : null}
                      {r.departure ? (
                        <div className="text-xs text-muted">{t.to}: {gregorian(r.departure, lang)}</div>
                      ) : r.next_arrival ? (
                        <div className="text-xs text-muted">{t.res_upcoming}: {gregorian(r.next_arrival, lang)}</div>
                      ) : null}
                    </div>
                  );
                  return r.reservation_id && canBook ? (
                    <Link key={r.unit_id} href={`/reservations/${r.reservation_id}`}>{body}</Link>
                  ) : (
                    <div key={r.unit_id}>{body}</div>
                  );
                })}
            </div>
          </div>
        ))
      )}
    </>
  );
}
