"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type T = Record<
  "login_title" | "signup_title" | "email" | "password" | "login_btn" | "signup_btn" | "have_account" | "no_account" | "check_email",
  string
>;

export function LoginForm({ t }: { t: T }) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email"));
    const password = String(fd.get("password"));
    const supabase = createClient();
    setPending(true);
    setError(null);
    setInfo(null);
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setPending(false);
      if (error) return setError(error.message);
      router.replace("/");
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      setPending(false);
      if (error) return setError(error.message);
      if (data.session) {
        router.replace("/onboarding");
        router.refresh();
      } else setInfo(t.check_email);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-6">
      <h1 className="h1">{mode === "login" ? t.login_title : t.signup_title}</h1>
      <label className="block">
        <span className="label">{t.email}</span>
        <input name="email" type="email" required autoComplete="email" dir="ltr" className="input" />
      </label>
      <label className="block">
        <span className="label">{t.password}</span>
        <input name="password" type="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} dir="ltr" className="input" />
      </label>
      {error ? <div role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div> : null}
      {info ? <div className="rounded-xl bg-ok-soft px-3 py-2 text-sm text-ok">{info}</div> : null}
      <button className="btn-primary w-full" disabled={pending}>
        {pending ? "…" : mode === "login" ? t.login_btn : t.signup_btn}
      </button>
      <button type="button" className="w-full text-center text-sm text-brand" onClick={() => setMode(mode === "login" ? "signup" : "login")}>
        {mode === "login" ? t.no_account : t.have_account}
      </button>
    </form>
  );
}
