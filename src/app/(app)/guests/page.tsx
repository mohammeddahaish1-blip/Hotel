import Link from "next/link";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { Empty, PageHeader } from "@/components/ui";

// FR-22: search by name, phone or document number
export default async function GuestsPage({ searchParams }: PageProps<"/guests">) {
  const ctx = await requireArea("guests");
  const { t } = await getDict();
  const q = String((await searchParams).q ?? "").trim();
  let query = ctx.supabase
    .from("guests")
    .select("id, full_name, full_name_ar, phone, nationality, doc_type, doc_number")
    .eq("tenant_id", ctx.tenantId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (q) {
    const s = q.replace(/[%,()]/g, " ");
    query = query.or(`full_name.ilike.%${s}%,full_name_ar.ilike.%${s}%,phone.ilike.%${s}%,doc_number.ilike.%${s}%`);
  }
  const { data: guests } = await query;

  return (
    <>
      <PageHeader title={t.guests_title} actions={<Link href="/guests/new" className="btn-primary">{t.guest_new}</Link>} />
      <form className="mb-4 flex gap-2">
        <input name="q" defaultValue={q} placeholder={`${t.name} / ${t.phone} / ${t.doc_number}`} className="input" />
        <button className="btn-ghost">{t.search}</button>
      </form>
      {!guests?.length ? (
        <Empty>{t.none}</Empty>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr><th>{t.name}</th><th>{t.phone}</th><th>{t.nationality}</th><th>{t.doc_number}</th></tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.id}>
                  <td><Link className="font-semibold text-brand" href={`/guests/${g.id}`}>{g.full_name}</Link>{g.full_name_ar ? <div className="text-xs text-muted">{g.full_name_ar}</div> : null}</td>
                  <td dir="ltr" className="text-start">{g.phone ?? "—"}</td>
                  <td>{g.nationality ?? "—"}</td>
                  <td>{g.doc_type ? `${t[`dt_${g.doc_type}` as DictKey]} · ` : ""}{g.doc_number ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
