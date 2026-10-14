"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type T = Record<"mfa_title" | "mfa_required" | "mfa_code" | "mfa_verify" | "mfa_enter" | "signOut", string>;

export function MfaForm({ t }: { t: T }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) return setError(error.message);
      const verified = data.totp.find((f) => f.status === "verified");
      if (verified) return setFactorId(verified.id);
      // Remove half-finished enrollments, then enroll a fresh TOTP factor
      for (const f of data.all.filter((f) => f.status === "unverified")) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const enroll = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `Nuzul ${Date.now()}` });
      if (enroll.error) return setError(enroll.error.message);
      setFactorId(enroll.data.id);
      setQr(enroll.data.totp.qr_code);
      setSecret(enroll.data.totp.secret);
    })();
  }, []);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!factorId) return;
    const code = String(new FormData(e.currentTarget).get("code")).trim();
    setPending(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setPending(false);
    if (error) return setError(error.message);
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-6">
      <h1 className="h1">{t.mfa_title}</h1>
      <p className="text-sm text-muted">{qr ? t.mfa_required : t.mfa_enter}</p>
      {qr ? (
        <div className="flex flex-col items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt="TOTP QR" className="h-44 w-44 rounded-lg bg-white p-2" />
          <code dir="ltr" className="break-all text-center text-xs text-muted">{secret}</code>
        </div>
      ) : null}
      <label className="block">
        <span className="label">{t.mfa_code}</span>
        <input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" dir="ltr" className="input text-center text-lg tracking-[0.4em]" />
      </label>
      {error ? <div role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div> : null}
      <button className="btn-primary w-full" disabled={pending || !factorId}>{pending ? "…" : t.mfa_verify}</button>
      <button
        type="button"
        className="w-full text-center text-sm text-muted"
        onClick={async () => {
          await createClient().auth.signOut();
          router.replace("/login");
        }}
      >
        {t.signOut}
      </button>
    </form>
  );
}
