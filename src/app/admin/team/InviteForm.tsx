"use client";

import { useActionState, useState } from "react";
import { Check, Copy } from "lucide-react";
import { teamInvite } from "@/app/actions/portal";

const ROLES: [string, string][] = [["ceo", "المدير التنفيذي"], ["finance", "المالية"], ["marketing", "التسويق"], ["it", "التقنية"], ["security", "الأمن السيبراني"], ["support", "الدعم"]];

/** Invite a team member: email, roles, two-step verification. Shows the one-time link to send. */
export function InviteForm() {
  const [state, act, pending] = useActionState(teamInvite, null);
  const [copied, setCopied] = useState(false);
  const link = state && "link" in state ? (state as { link?: string }).link : undefined;
  return (
    <form action={act} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-sm font-semibold">البريد الإلكتروني</span>
        <input name="email" type="email" required dir="ltr" autoCapitalize="none" placeholder="name@example.com" className="input" />
      </label>
      <fieldset>
        <legend className="mb-1.5 text-sm font-semibold">الأدوار <span className="font-normal text-muted">(أكثر من دور مسموح)</span></legend>
        <div className="flex flex-wrap gap-2">
          {ROLES.map(([k, l]) => (
            <label key={k} className="cursor-pointer">
              <input type="checkbox" name="roles" value={k} className="peer sr-only" />
              <span className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-sm font-semibold peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white peer-focus-visible:ring-2 peer-focus-visible:ring-brand">{l}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center justify-between gap-3 rounded-2xl bg-surface-2 px-3 py-2.5">
        <span className="text-sm"><b className="block">تحقق بخطوتين إلزامي</b><span className="text-xs text-muted">ما يدخل البوابة قبل ما يفعّله</span></span>
        <input type="checkbox" name="mfa" defaultChecked className="size-5 accent-[#0d6b5f]" />
      </label>
      <button className="btn-primary w-full" disabled={pending}>{pending ? "…" : "إنشاء الدعوة"}</button>
      {state?.error ? <p role="alert" className="text-sm font-semibold text-danger">{state.error}</p> : null}
      {link ? (
        <div className="space-y-2 rounded-2xl border border-ok/30 bg-ok-soft p-3">
          <p className="text-sm font-semibold text-ok">{state?.ok}</p>
          <div dir="ltr" className="break-all rounded-xl bg-surface p-2 text-xs">{link}</div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost btn-sm inline-flex items-center gap-1.5" onClick={() => { navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => {}); }}>
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? "تم النسخ" : "نسخ الرابط"}
            </button>
            <a className="btn-primary btn-sm" target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(`دعوة للانضمام لفريق نُزُل:\n${link}\nسجّل دخولك بنفس البريد اللي وصلته الدعوة.`)}`}>إرسال واتساب</a>
          </div>
          <p className="text-xs text-muted">الرابط يظهر مرة وحدة، صالح 7 أيام ولشخص واحد.</p>
        </div>
      ) : null}
    </form>
  );
}
