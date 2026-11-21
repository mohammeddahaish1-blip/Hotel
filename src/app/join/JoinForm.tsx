"use client";

import { useActionState } from "react";
import Link from "next/link";
import { joinTeam } from "@/app/actions/portal";

export function JoinForm({ token }: { token: string }) {
  const [state, act, pending] = useActionState(joinTeam, null);
  if (state?.ok) {
    return (
      <div className="space-y-3">
        <p className="font-semibold text-ok">{state.ok}</p>
        <Link href="/admin" className="btn-primary w-full">افتح البوابة</Link>
        <p className="text-xs text-muted">إذا دورك يتطلب تحقق بخطوتين، بنطلب منك تفعيله أول ما تفتح البوابة.</p>
      </div>
    );
  }
  return (
    <form action={act} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <button className="btn-primary w-full" disabled={pending}>{pending ? "…" : "قبول الدعوة"}</button>
      {state?.error ? <p role="alert" className="text-sm font-semibold text-danger">{state.error}</p> : null}
    </form>
  );
}
