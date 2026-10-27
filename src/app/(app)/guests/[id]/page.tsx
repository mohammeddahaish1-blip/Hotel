import Link from "next/link";
import { notFound } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { gregorian, dateTime, omr, parseRange } from "@/lib/format";
import { Badge, Empty, PageHeader, Section, RES_STATUS_TONE, RES_STATUS_EMOJI, Crumb } from "@/components/ui";
import { GuestForm } from "@/components/GuestForm";

export default async function GuestPage({ params }: PageProps<"/guests/[id]">) {
  const ctx = await requireArea("guests");
  const { t, lang } = await getDict();
  const { id } = await params;
  const { data: g } = await ctx.supabase.from("guests").select("*").eq("id", id).maybeSingle();
  if (!g) notFound();
  const [{ data: stays }, { data: docs }, { data: prop }] = await Promise.all([
    ctx.supabase.from("reservations").select("id, code, stay, status, room_total, discount_amount, units(number)").eq("guest_id", id).order("stay", { ascending: false }),
    ctx.supabase.from("guest_documents").select("id, storage_path, kind, delete_after, created_at").eq("guest_id", id).order("created_at", { ascending: false }),
    ctx.supabase.from("properties").select("doc_retention_days").eq("id", ctx.property.id).single(),
  ]);
  // NFR-03: images open only through /api/guest-doc (logged, 60-second link); owner/manager see who opened them
  const seesLog = hasRole(ctx, ["manager"]);
  const [{ data: log }, { data: staff }] = seesLog && docs?.length
    ? await Promise.all([
        ctx.supabase.from("document_access_log").select("guest_document_id, viewed_by, viewed_at").eq("guest_id", id).order("viewed_at", { ascending: false }).limit(200),
        ctx.supabase.from("memberships").select("user_id, full_name").eq("tenant_id", ctx.tenantId),
      ])
    : [{ data: [] }, { data: [] }];
  const who = new Map((staff ?? []).map((m) => [m.user_id, m.full_name]));
  const views = (docId: string) => (log ?? []).filter((l) => l.guest_document_id === docId);

  return (
    <>
      <Crumb href="/guests" label={t.nav_guests} />
      <PageHeader
        title={g.full_name}
        sub={<>{g.full_name_ar ? `${g.full_name_ar} · ` : ""}{lang === "ar" ? "موافقة بتاريخ" : "Consent on"} {dateTime(g.consent_at, ctx.property.timezone, lang)}</>}
        actions={<Link href={`/reservations/new?guest=${g.id}`} className="btn-primary">{t.res_new}</Link>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <GuestForm t={t} tenantId={ctx.tenantId} retentionDays={prop?.doc_retention_days ?? 365} guest={g} />
        </div>
        <div className="space-y-4">
          <Section title={t.guest_history}>
            {!stays?.length ? (
              <Empty>{t.none}</Empty>
            ) : (
              <ul className="divide-y divide-line">
                {stays.map((s) => {
                  const r = parseRange(s.stay as string);
                  const unit = (s.units as unknown as { number: string } | null)?.number;
                  return (
                    <li key={s.id} className="py-2 text-sm">
                      <Link href={`/reservations/${s.id}`} className="flex items-center justify-between gap-2">
                        <span>{s.code} · {t.unit} {unit}</span>
                        <Badge tone={RES_STATUS_TONE[s.status]}><span aria-hidden>{RES_STATUS_EMOJI[s.status]}</span> {t[`rs_${s.status}` as DictKey]}</Badge>
                      </Link>
                      <div className="text-xs text-muted">{gregorian(r.from, lang)} → {gregorian(r.to, lang)} · {omr(s.room_total - s.discount_amount, lang)}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <Section title={t.guest_docs}>
            {!docs?.length ? (
              <Empty>{t.none}</Empty>
            ) : (
              <ul className="space-y-2">
                {docs.map((d) => (
                  <li key={d.id} className="text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span>🔒 {t[`dt_${d.kind}` as DictKey]} · {gregorian(d.created_at, lang)}</span>
                      <a href={`/api/guest-doc/${d.id}`} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">{t.doc_view}</a>
                    </div>
                    {seesLog ? (
                      <details className="text-xs text-muted">
                        <summary className="cursor-pointer">{t.doc_views.replace("{n}", String(views(d.id).length))}</summary>
                        <ul className="mt-1 space-y-0.5">
                          {views(d.id).slice(0, 20).map((v, k) => (
                            <li key={k}>{who.get(v.viewed_by) ?? "—"} · {dateTime(v.viewed_at, ctx.property.timezone, lang)}</li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                    {d.delete_after ? <div className="text-xs text-muted">{lang === "ar" ? "يُحذف تلقائياً في" : "Auto-deletes on"} {gregorian(d.delete_after, lang)}</div> : null}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-muted">{t.doc_protected}</p>
          </Section>
        </div>
      </div>
    </>
  );
}
