import { portalMe, requireAdmin, ROLE_AR, ROLES, SECTION_AR, SECTIONS, can } from "@/lib/admin";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, PageHeader } from "@/components/ui";
import { teamRemove, teamRevokeInvite, teamSetPerm, teamSetRoles, teamSuspend } from "@/app/actions/portal";
import { InviteForm } from "./InviteForm";

type Member = { user_id: string; email: string; name: string | null; owner: boolean; roles: string[]; active: boolean; require_mfa: boolean; last_sign_in: string | null; mfa: boolean; sessions: number };
type Invite = { id: string; email: string; roles: string[]; expires_at: string };
const LEVEL_AR = { edit: "تعديل", view: "عرض" } as const;

/** Who is on the team, with which roles, and what each role may do. Only the owner changes it. */
export default async function TeamPage() {
  const sb = await requireAdmin(["team", "security"]);
  const { me } = await portalMe();
  const owner = me.owner;
  const [{ data, error }, { data: perms }] = await Promise.all([sb.rpc("admin_team"), sb.from("platform_role_perms").select("role, section, level")]);
  if (error) throw new Error(error.message);
  const members = ((data as { members: Member[] } | null)?.members ?? []);
  const invites = ((data as { invites: Invite[] } | null)?.invites ?? []);
  const P = new Map(((perms ?? []) as { role: string; section: string; level: "view" | "edit" }[]).map((p) => [`${p.role}:${p.section}`, p.level]));
  const noMfa = members.filter((m) => !m.owner && m.active && !m.mfa).length;

  const kpis: [string, number, string, string][] = [
    ["أعضاء الفريق", members.length, `${members.filter((m) => m.owner).length} مالك · ${members.filter((m) => !m.owner).length} عضو`, ""],
    ["دعوات معلّقة", invites.length, "بانتظار القبول", ""],
    ["بدون تحقق بخطوتين", noMfa, noMfa ? "لازم يفعّله قبل الدخول" : "الكل مفعّل", noMfa ? "text-danger" : "text-ok"],
    ["موقوفون", members.filter((m) => !m.active).length, "ما يقدرون يدخلون", ""],
  ];

  return (
    <>
      <PageHeader title="الفريق والصلاحيات" sub="من يدخل البوابة، وبأي دور، ووش يقدر يسوي" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([l, v, h, tone]) => (
          <div key={l} className="card p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className={`num mt-1 text-2xl font-bold ${tone}`}>{v}</div><div className="mt-0.5 text-xs text-muted">{h}</div></div>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-4">
          <section className="card">
            <h2 className="h2 mb-1">الأعضاء</h2>
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.user_id} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className={`grid size-10 shrink-0 place-items-center rounded-2xl font-bold ${m.owner ? "bg-[#083f39] text-[#f3d27a]" : "bg-brand-soft text-brand"}`}>{(m.name || m.email).charAt(0).toUpperCase()}</span>
                    <span className="min-w-0 flex-1 basis-40">
                      <b className="block truncate">{m.name || m.email}</b>
                      <span className="block truncate text-xs text-muted" dir="ltr">{m.email}</span>
                      <span className="block text-xs text-muted">آخر دخول: {m.last_sign_in ? dateTime(m.last_sign_in, "Asia/Muscat", "ar") : "لم يدخل"}</span>
                    </span>
                    <span className="flex flex-wrap gap-1.5">
                      {m.owner ? <Badge tone="warn">المالك</Badge> : m.roles.map((r) => <Badge key={r} tone="info">{ROLE_AR[r] ?? r}</Badge>)}
                      {!m.active ? <Badge tone="danger">موقوف</Badge> : null}
                      {m.mfa ? <Badge tone="ok">✓ تحقق بخطوتين</Badge> : <Badge tone={m.owner ? "gray" : "danger"}>بدون تحقق بخطوتين</Badge>}
                    </span>
                  </div>
                  {!m.owner && owner ? (
                    <details className="mt-2 rounded-2xl bg-surface-2 p-3">
                      <summary className="cursor-pointer text-sm font-semibold text-brand">تعديل الأدوار أو الإيقاف</summary>
                      <ActionForm action={teamSetRoles} className="mt-3 space-y-3">
                        <input type="hidden" name="user" value={m.user_id} />
                        <label className="block"><span className="mb-1 block text-sm font-semibold">الاسم في البوابة</span><input name="name" defaultValue={m.name ?? ""} className="input" /></label>
                        <div className="flex flex-wrap gap-2">
                          {ROLES.map((r) => (
                            <label key={r} className="cursor-pointer">
                              <input type="checkbox" name="roles" value={r} defaultChecked={m.roles.includes(r)} className="peer sr-only" />
                              <span className="inline-flex rounded-full border border-line px-3 py-1.5 text-sm font-semibold peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white">{ROLE_AR[r]}</span>
                            </label>
                          ))}
                        </div>
                        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="mfa" defaultChecked={m.require_mfa} className="size-4 accent-[#0d6b5f]" />تحقق بخطوتين إلزامي</label>
                        <SubmitButton className="btn-primary btn-sm">حفظ</SubmitButton>
                      </ActionForm>
                      <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                        <ActionForm action={teamSuspend}>
                          <input type="hidden" name="user" value={m.user_id} /><input type="hidden" name="active" value={m.active ? "0" : "1"} />
                          <SubmitButton className="btn-ghost btn-sm" confirm={m.active ? "إيقاف العضو؟ تنقطع جلساته فوراً." : undefined}>{m.active ? "إيقاف" : "إعادة تفعيل"}</SubmitButton>
                        </ActionForm>
                        <ActionForm action={teamRemove}>
                          <input type="hidden" name="user" value={m.user_id} />
                          <SubmitButton className="btn-ghost btn-sm text-danger" confirm="إزالة العضو من الفريق؟ حسابه يبقى لكن ما يدخل البوابة.">إزالة من الفريق</SubmitButton>
                        </ActionForm>
                      </div>
                    </details>
                  ) : null}
                  {!m.owner && !owner && can(me, "security", "edit") ? (
                    <ActionForm action={teamSuspend} className="mt-2">
                      <input type="hidden" name="user" value={m.user_id} /><input type="hidden" name="active" value={m.active ? "0" : "1"} />
                      <SubmitButton className="btn-ghost btn-sm" confirm={m.active ? "إيقاف العضو؟ تنقطع جلساته فوراً." : undefined}>{m.active ? "إيقاف" : "إعادة تفعيل"}</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-surface-2 text-muted">✉</span>
                  <span className="min-w-0 flex-1"><b className="text-muted">دعوة معلّقة</b><span className="block truncate text-xs text-muted" dir="ltr">{i.email}</span><span className="block text-xs text-muted">تنتهي {dateTime(i.expires_at, "Asia/Muscat", "ar")}</span></span>
                  <span className="flex flex-wrap gap-1.5">{i.roles.map((r) => <Badge key={r} tone="info">{ROLE_AR[r] ?? r}</Badge>)}</span>
                  {owner ? (
                    <ActionForm action={teamRevokeInvite}><input type="hidden" name="id" value={i.id} /><SubmitButton className="btn-ghost btn-sm">إلغاء</SubmitButton></ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="card overflow-x-auto">
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="h2">صلاحيات كل دور</h2>
              <span className="text-xs text-muted">{owner ? "اضغط أي خانة لتغييرها" : "المالك فقط يعدّل هذا الجدول"}</span>
            </div>
            <table className="w-full min-w-[46rem] text-sm">
              <thead><tr className="text-xs text-muted"><th className="py-2 text-start font-semibold">القسم</th><th className="font-semibold">المالك</th>{ROLES.map((r) => <th key={r} className="font-semibold">{ROLE_AR[r]}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {SECTIONS.map((sec) => (
                  <tr key={sec}>
                    <td className="py-2 font-semibold">{SECTION_AR[sec]}</td>
                    <td className="text-center font-bold text-brand">تعديل</td>
                    {ROLES.map((r) => {
                      const lv = P.get(`${r}:${sec}`);
                      const next = lv === "edit" ? "" : lv === "view" ? "edit" : "view";
                      const label = lv ? LEVEL_AR[lv] : "—";
                      const cls = lv === "edit" ? "font-bold text-brand" : lv === "view" ? "font-semibold text-warn" : "text-muted";
                      return (
                        <td key={r} className="text-center">
                          {owner && sec !== "team" ? (
                            <ActionForm action={teamSetPerm} className="inline">
                              <input type="hidden" name="role" value={r} /><input type="hidden" name="section" value={sec} /><input type="hidden" name="level" value={next} />
                              <SubmitButton className={`rounded-lg px-2 py-1 hover:bg-surface-2 ${cls}`}>{label}</SubmitButton>
                            </ActionForm>
                          ) : <span className={cls}>{sec === "team" && lv === "edit" ? "عرض" : label}</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">"الفريق والصلاحيات" تعديله للمالك فقط مهما كانت الصلاحية.</p>
          </section>
        </div>

        <div className="space-y-4">
          {owner ? (
            <section className="card"><h2 className="h2 mb-3">دعوة عضو</h2><InviteForm /></section>
          ) : null}
          <section className="card bg-danger-soft/40">
            <h2 className="h2 mb-2 text-danger">قواعد ثابتة</h2>
            <ul className="list-disc space-y-1.5 ps-5 text-sm">
              <li>حساب المالك ما يُحذف ولا تنقص صلاحياته.</li>
              <li>الأمن السيبراني يقدر يوقف أي عضو ما عدا المالك.</li>
              <li>العضو الموقوف تنقطع جلساته فوراً.</li>
              <li>كل تغيير في الأدوار يتسجّل باسم من سوّاه.</li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
