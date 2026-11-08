import { requireFeature } from "@/lib/plan";
import { Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { dateTime, gregorian, parseRange, todayIn } from "@/lib/format";
import { appUrl } from "@/lib/feedback-qr";
import { addFeed, deleteFeed, syncChannelsNow, toggleFeed } from "@/app/actions/channels";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { CopyField } from "@/components/CopyField";
import { Badge, Empty, Field, PageHeader, Section } from "@/components/ui";

const CHANNELS = ["airbnb", "booking", "agoda", "expedia", "other"] as const;
type Feed = { id: string; unit_id: string; channel: string; url: string; active: boolean; last_synced_at: string | null; last_error: string | null; last_event_count: number | null };

/** Calendar sync with Airbnb / Booking.com / Agoda / Expedia by iCal links, per unit. */
export default async function ChannelsPage() {
  const ctx = await requireArea("board");
  await requireFeature(ctx, "channels");
  if (!hasRole(ctx, ["manager", "reception"])) redirect("/board");
  const { t, lang } = await getDict();
  const isManager = hasRole(ctx, ["manager"]);
  const today = todayIn(ctx.property.timezone);
  const [{ data: units }, { data: feeds }, { data: blocks }] = await Promise.all([
    ctx.supabase.from("units").select("id, number, ical_token").eq("property_id", ctx.property.id).eq("active", true).order("number"),
    ctx.supabase.from("ical_feeds").select("*").eq("property_id", ctx.property.id).order("created_at"),
    ctx.supabase.from("channel_blocks").select("id, unit_id, stay, summary, ical_feeds(channel)").eq("property_id", ctx.property.id)
      .is("removed_at", null).is("reservation_id", null).overlaps("stay", `[${today},2100-01-01)`).order("stay").limit(100),
  ]);
  const base = await appUrl("/ical/");
  const feedsOf = (u: string) => ((feeds ?? []) as Feed[]).filter((f) => f.unit_id === u);
  const unitNo = new Map((units ?? []).map((u) => [u.id, u.number]));
  const tz = ctx.property.timezone;

  return (
    <>
      <PageHeader
        title={t.ch_title}
        sub={t.ch_hint}
        actions={
          <ActionForm action={syncChannelsNow}>
            <SubmitButton className="btn-primary btn-sm inline-flex items-center gap-1.5"><RefreshCw className="size-4 shrink-0" />{t.ch_sync_now}</SubmitButton>
          </ActionForm>
        }
      />
      <div className="space-y-4">
        <Section title={`${t.ch_blocks} (${(blocks ?? []).length})`}>
          {(blocks ?? []).length === 0 ? (
            <Empty>{t.ch_no_blocks}</Empty>
          ) : (
            <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>{t.unit}</th><th>{t.source}</th><th>{t.from}</th><th>{t.to}</th><th></th></tr></thead>
              <tbody>
                {(blocks ?? []).map((b) => {
                  const s = parseRange(b.stay as string);
                  const ch = (b.ical_feeds as unknown as { channel: string } | null)?.channel ?? "other";
                  return (
                    <tr key={b.id}>
                      <td className="num font-semibold">{unitNo.get(b.unit_id)}</td>
                      <td><Badge tone="warn">{t[`src_${ch}` as DictKey]}</Badge> <span className="text-xs text-muted">{b.summary}</span></td>
                      <td className="text-xs">{gregorian(s.from, lang)}</td>
                      <td className="text-xs">{gregorian(s.to, lang)}</td>
                      <td><Link href={`/channels/convert/${b.id}`} className="btn-ghost btn-sm">{t.ch_convert}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          )}
        </Section>

        <Section title={t.ch_units}>
          <p className="mb-3 text-xs text-muted">{t.ch_export_hint}</p>
          <div className="space-y-3">
            {(units ?? []).map((u) => (
              <div key={u.id} className="rounded-xl border border-line p-3">
                <div className="mb-2 flex items-center gap-2"><span className="num text-lg font-bold">{u.number}</span></div>
                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="space-y-1.5">
                    <div className="label">{t.ch_export}</div>
                    <CopyField value={`${base}${u.ical_token}.ics`} label={t.ch_copy} copied={t.ch_copied} />
                  </div>
                  <div className="space-y-1.5">
                    <div className="label">{t.ch_import}</div>
                    {feedsOf(u.id).length === 0 ? <p className="text-xs text-muted">{t.ch_no_feeds}</p> : null}
                    {feedsOf(u.id).map((f) => (
                      <div key={f.id} className={`flex flex-wrap items-center gap-2 text-xs ${f.active ? "" : "opacity-60"}`}>
                        <Badge tone="brand">{t[`src_${f.channel}` as DictKey]}</Badge>
                        <span dir="ltr" className="max-w-48 truncate text-muted" title={f.url}>{f.url}</span>
                        {f.last_error ? <Badge tone="danger">{f.last_error}</Badge> : f.last_synced_at ? <span className="text-ok">{t.ch_last_sync} {dateTime(f.last_synced_at, tz, lang)} · {f.last_event_count ?? 0}</span> : <span className="text-muted">{t.ch_never}</span>}
                        {isManager ? (
                          <span className="ms-auto flex gap-1">
                            <ActionForm action={toggleFeed}>
                              <input type="hidden" name="id" value={f.id} /><input type="hidden" name="active" value={f.active ? "0" : "1"} />
                              <SubmitButton className="btn-ghost btn-sm" aria-label={f.active ? t.auto_pause : t.auto_resume}>{f.active ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</SubmitButton>
                            </ActionForm>
                            <ActionForm action={deleteFeed}>
                              <input type="hidden" name="id" value={f.id} />
                              <SubmitButton className="btn-ghost btn-sm text-danger" confirm={t.ch_delete_q}><Trash2 className="size-3.5" /></SubmitButton>
                            </ActionForm>
                          </span>
                        ) : null}
                      </div>
                    ))}
                    {feedsOf(u.id).length ? (
                      <div className="pt-1 text-xs text-muted">
                        {t.ch_export_for}:{" "}
                        {[...new Set(feedsOf(u.id).map((f) => f.channel))].map((ch) => (
                          <span key={ch} className="me-2 inline-block"><CopyField value={`${base}${u.ical_token}.ics?for=${ch}`} label={t[`src_${ch}` as DictKey]} copied={t.ch_copied} /></span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {isManager ? (
            <ActionForm action={addFeed} resetOnSuccess className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-6">
              <div className="h2 sm:col-span-6">{t.ch_add}</div>
              <Field label={t.unit}>
                <select name="unit" required className="input">{(units ?? []).map((u) => <option key={u.id} value={u.id}>{u.number}</option>)}</select>
              </Field>
              <Field label={t.source}>
                <select name="channel" className="input">{CHANNELS.map((c) => <option key={c} value={c}>{t[`src_${c}` as DictKey]}</option>)}</select>
              </Field>
              <Field label={t.ch_url} className="sm:col-span-3"><input name="url" required dir="ltr" placeholder="https://www.airbnb.com/calendar/ical/….ics" className="input" /></Field>
              <div className="flex items-end"><SubmitButton className="btn-primary w-full">{t.add}</SubmitButton></div>
            </ActionForm>
          ) : null}
        </Section>
      </div>
    </>
  );
}
