import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { ACTION_AR, can, portalMe, requireAdmin, ROLE_AR } from "@/lib/admin";
import { dateTime } from "@/lib/format";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, PageHeader } from "@/components/ui";
import { securityKillOthers, securityKillSession, securitySave, teamSuspend } from "@/app/actions/portal";

type Member = { user_id: string; email: string; name: string | null; owner: boolean; roles: string[]; active: boolean; require_mfa: boolean; mfa: boolean; last_sign_in: string | null };
type Sess = { id: string; user_id: string; email: string; name: string | null; owner: boolean; user_agent: string | null; ip: string | null; created_at: string; last: string; aal: string; current: boolean };
type Log = { id: number; actor_email: string | null; action: string; detail: string | null; at: string };
const SEC_ACTIONS = ["staff_invite", "staff_join", "staff_roles", "staff_suspend", "staff_resume", "staff_remove", "session_end", "security", "approval_ok", "approval_no"];

/** Readable device from a browser's user agent. */
function device(ua: string | null) {
  if (!ua) return "جهاز غير معروف";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "جهاز";
  const br = /Edg\//.test(ua) ? "إيدج" : /CriOS|Chrome\//.test(ua) ? "كروم" : /FxiOS|Firefox\//.test(ua) ? "فايرفوكس" : /Safari\//.test(ua) ? "سفاري" : "متصفح";
  return `${os} · ${br}`;
}

/** Protecting team accounts: two-step verification, open sessions, stopping a member, security events. */
export default async function SecurityPage() {
  const sb = await requireAdmin("security");
  const { me } = await portalMe();
  const edit = can(me, "security", "edit");
  const [{ data: team }, { data: ses, error }, { data: logs }, { data: pol }] = await Promise.all([
    sb.rpc("admin_team"),
    sb.rpc("admin_sessions"),
    sb.from("admin_log").select("id, actor_email, action, detail, at").in("action", SEC_ACTIONS).order("at", { ascending: false }).limit(12),
    sb.from("platform_security").select("session_hours").eq("id", 1).maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  const members = ((team as { members: Member[] } | null)?.members ?? []);
  const sessions = (ses ?? []) as Sess[];
  const noMfa = members.filter((m) => !m.owner && m.active && !m.mfa);
  const ownerNoMfa = members.some((m) => m.owner && !m.mfa);
  const hours = (pol as { session_hours: number } | null)?.session_hours ?? 12;
  const old = sessions.filter((x) => Date.now() - Date.parse(x.last) > 30 * 86_400_000);
  const issues = [
    noMfa.length ? `${noMfa.length} عضو بدون تحقق بخطوتين` : null,
    ownerNoMfa ? "حساب المالك بدون تحقق بخطوتين" : null,
    sessions.length > 20 ? `${sessions.length} جلسة مفتوحة لحسابات الفريق` : null,
  ].filter(Boolean) as string[];
  const others = sessions.filter((x) => !x.current && (!x.owner || x.user_id === sessions.find((y) => y.current)?.user_id));

  const kpis: [string, React.ReactNode, string, string][] = [
    ["جلسات مفتوحة", <span key="s" className="num">{sessions.length}</span>, `${old.length} منها ما استُخدمت من شهر`, sessions.length > 20 ? "text-warn" : ""],
    ["بدون تحقق بخطوتين", <span key="m" className="num">{noMfa.length + (ownerNoMfa ? 1 : 0)}</span>, ownerNoMfa ? "يشمل حساب المالك" : "من أعضاء الفريق", noMfa.length || ownerNoMfa ? "text-danger" : "text-ok"],
    ["أعضاء موقوفون", <span key="x" className="num">{members.filter((m) => !m.active).length}</span>, "لا يدخلون البوابة", ""],
    ["محاولات دخول فاشلة", <span key="f" className="rounded-full border border-dashed border-line px-2.5 py-0.5 text-xs font-bold text-muted">◌ بانتظار الربط</span>, "من سجلّات مزوّد الدخول", ""],
  ];

  return (
    <>
      <PageHeader title="الأمن السيبراني" sub="حماية حسابات الفريق والبيانات" />
      {issues.length ? (
        <div className="card mb-4 flex items-start gap-3 border border-warn/40 bg-warn-soft">
          <AlertTriangle className="mt-0.5 size-6 shrink-0 text-warn" aria-hidden />
          <div className="min-w-0 flex-1"><b>{issues.length} أمور تحتاج انتباهك</b><p className="text-sm text-muted">{issues.join(" · ")}</p></div>
        </div>
      ) : null}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map(([l, v, h, tone]) => (
          <div key={l} className="card p-4"><div className="text-xs font-semibold text-muted">{l}</div><div className={`mt-1 text-2xl font-bold ${tone}`}>{v}</div><div className="mt-0.5 text-xs text-muted">{h}</div></div>
        ))}
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-4">
          <section className="card">
            <h2 className="h2 mb-1">التحقق بخطوتين للفريق</h2>
            <ul className="divide-y divide-line">
              {members.map((m) => (
                <li key={m.user_id} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-0 flex-1 basis-40"><b className="block truncate">{m.name || m.email}</b><span className="text-xs text-muted">{m.owner ? ROLE_AR.owner : m.roles.map((r) => ROLE_AR[r] ?? r).join("، ")}</span></span>
                  {m.mfa ? <Badge tone="ok">✓ مفعّل</Badge> : <Badge tone="danger">غير مفعّل</Badge>}
                  {!m.owner ? (m.require_mfa ? <Badge tone="info">إلزامي</Badge> : <Badge tone="gray">اختياري</Badge>) : null}
                  {!m.active ? <Badge tone="danger">موقوف</Badge> : null}
                  {edit && !m.owner ? (
                    <ActionForm action={teamSuspend}>
                      <input type="hidden" name="user" value={m.user_id} /><input type="hidden" name="active" value={m.active ? "0" : "1"} />
                      <SubmitButton className={m.active ? "btn-ghost btn-sm text-danger" : "btn-ghost btn-sm"} confirm={m.active ? "إيقاف العضو؟ تنقطع جلساته فوراً." : undefined}>{m.active ? "إيقاف" : "إعادة"}</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
            {ownerNoMfa ? <p className="mt-2 text-xs text-muted">نوصي المالك بتفعيل التحقق بخطوتين: <Link href="/mfa?next=/admin/security" className="font-semibold text-brand hover:underline">فعّله الآن</Link>.</p> : null}
          </section>

          <section className="card">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 className="h2">أحداث أمنية</h2>
              {can(me, "log") ? <Link href="/admin/log" className="btn-ghost btn-sm">السجل الكامل (قراءة فقط)</Link> : null}
            </div>
            {(logs ?? []).length ? (
              <ul className="divide-y divide-line">
                {((logs ?? []) as Log[]).map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                    <span className={`size-2.5 shrink-0 rounded-full ${/suspend|remove|session_end|approval_no/.test(l.action) ? "bg-danger" : "bg-brand"}`} />
                    <span className="min-w-0 flex-1"><b>{ACTION_AR[l.action] ?? l.action}</b>{l.detail ? <span className="text-muted"> · {l.detail}</span> : null}<span className="block text-xs text-muted" dir="ltr">{l.actor_email}</span></span>
                    <span className="text-xs text-muted">{dateTime(l.at, "Asia/Muscat", "ar")}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">لا أحداث بعد.</p>}
          </section>
        </div>

        <div className="space-y-4">
          <section className="card">
            <h2 className="h2 mb-2">سياسات الأمان</h2>
            <ul className="divide-y divide-line text-sm">
              <li className="flex items-center justify-between gap-3 py-2.5"><span>تحقق بخطوتين للفريق</span><span className="text-xs text-muted">يُحدد لكل عضو</span></li>
              <li className="py-2.5">
                {edit ? (
                  <ActionForm action={securitySave} className="flex items-center justify-between gap-2">
                    <span>تنتهي جلسة العضو بعد</span>
                    <span className="flex items-center gap-1.5"><input name="hours" type="number" min={1} max={168} defaultValue={hours} className="input w-20 py-1.5 text-center" /> ساعة <SubmitButton className="btn-primary btn-sm">حفظ</SubmitButton></span>
                  </ActionForm>
                ) : <span className="flex justify-between"><span>تنتهي جلسة العضو بعد</span><b className="num">{hours} ساعة</b></span>}
              </li>
              <li className="flex items-center justify-between gap-3 py-2.5"><span>قفل الحساب بعد محاولات فاشلة</span><span className="rounded-full border border-dashed border-line px-2 py-0.5 text-xs font-bold text-muted">◌ بانتظار الربط</span></li>
              <li className="flex items-center justify-between gap-3 py-2.5"><span>تنبيه عند دخول من دولة جديدة</span><span className="rounded-full border border-dashed border-line px-2 py-0.5 text-xs font-bold text-muted">◌ بانتظار الربط</span></li>
            </ul>
            <p className="mt-2 text-xs text-muted">مدة الجلسة لا تنطبق على حساب المالك.</p>
          </section>

          <section className="card">
            <h2 className="h2 mb-1">جلسات الفريق المفتوحة</h2>
            <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">
              {sessions.slice(0, 40).map((x) => (
                <li key={x.id} className="flex items-center gap-2 py-2.5">
                  <span className="min-w-0 flex-1 text-sm">
                    <b className="block truncate">{x.name || x.email}</b>
                    <span className="block text-xs text-muted">{device(x.user_agent)} · آخر استخدام {dateTime(x.last, "Asia/Muscat", "ar")}</span>
                  </span>
                  {x.current ? <Badge tone="ok">هذا الجهاز</Badge> : edit && (!x.owner || me.owner) ? (
                    <ActionForm action={securityKillSession}><input type="hidden" name="id" value={x.id} /><SubmitButton className="btn-ghost btn-sm text-danger">إنهاء</SubmitButton></ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
            {sessions.length > 40 ? <p className="text-xs text-muted">وأيضاً {sessions.length - 40} جلسة أقدم.</p> : null}
            {edit && others.length ? (
              <ActionForm action={securityKillOthers} className="mt-3">
                {others.map((x) => <input key={x.id} type="hidden" name="ids" value={x.id} />)}
                <SubmitButton className="btn-ghost btn-sm w-full text-danger" confirm={`إنهاء ${others.length} جلسة؟ أصحابها يحتاجون يدخلون من جديد.`}>إنهاء كل الجلسات ما عدا جلستي ({others.length})</SubmitButton>
              </ActionForm>
            ) : null}
          </section>

          <section className="card">
            <div className="flex items-center justify-between gap-2"><h2 className="h2">فحص قاعدة البيانات</h2><span className="rounded-full border border-dashed border-line px-2 py-0.5 text-xs font-bold text-muted">◌ بانتظار الربط</span></div>
            <p className="mt-1 text-sm text-muted">يعرض تنبيهات الصلاحيات والجداول المكشوفة لما تربط مزوّد قاعدة البيانات.</p>
          </section>
        </div>
      </div>
    </>
  );
}
