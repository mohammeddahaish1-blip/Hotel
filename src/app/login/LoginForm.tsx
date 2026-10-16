"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type T = Record<
  | "login_title" | "signup_title" | "email" | "password" | "login_btn" | "signup_btn" | "have_account" | "no_account"
  | "check_email" | "already_registered" | "forgot_password" | "reset_title" | "reset_btn" | "reset_sent"
  | "invalid_login" | "email_not_confirmed" | "show_password" | "link_other_device",
  string
>;

type Mode = "login" | "signup" | "reset";

export function LoginForm({ t, notice }: { t: T; notice?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(notice === "link" ? t.link_other_device : null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = String(fd.get("email")).trim();
    const password = String(fd.get("password") ?? "");
    const supabase = createClient();
    const callback = `${window.location.origin}/auth/callback`;
    setPending(true);
    setError(null);
    setInfo(null);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      setPending(false);
      if (error) {
        if (error.code === "invalid_credentials") return setError(t.invalid_login);
        if (error.code === "email_not_confirmed") return setError(t.email_not_confirmed);
        return setError(error.message);
      }
      router.replace("/");
      router.refresh();
    } else if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callback } });
      setPending(false);
      if (error) return setError(error.message);
      if (data.session) {
        router.replace("/onboarding");
        router.refresh();
      } else if (data.user && data.user.identities?.length === 0) {
        // Supabase returns a user without identities when the email already exists
        setMode("login");
        setInfo(t.already_registered);
      } else setInfo(t.check_email);
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${callback}?next=/auth/update-password`,
      });
      setPending(false);
      if (error) return setError(error.message);
      setInfo(t.reset_sent);
    }
  }

  const title = mode === "login" ? t.login_title : mode === "signup" ? t.signup_title : t.reset_title;
  const button = mode === "login" ? t.login_btn : mode === "signup" ? t.signup_btn : t.reset_btn;

  return (
    <form onSubmit={onSubmit} className="relative w-full max-w-xs space-y-4 text-center">
      <h1 className="text-3xl font-bold">{title}</h1>
      <div className="mx-auto h-1 w-16 rounded-full bg-white/90" />
      <label className="block pt-4">
        <span className="mb-2 block text-xs text-white/80">{t.email}</span>
        <input name="email" type="email" required autoComplete="email" dir="ltr" placeholder="name@hotel.om" className="pill-input" />
      </label>
      {mode !== "reset" ? (
        <label className="block">
          <span className="mb-2 block text-xs text-white/80">{t.password}</span>
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            dir="ltr"
            placeholder="••••••••"
            className="pill-input"
          />
          <span className="mt-2 flex items-center justify-center gap-2 text-xs text-white/80">
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} className="accent-white" />
            {t.show_password}
          </span>
        </label>
      ) : null}
      {error ? <div role="alert" className="rounded-2xl bg-white px-3 py-2 text-sm text-danger">{error}</div> : null}
      {info ? <div className="rounded-2xl bg-white/15 px-3 py-2 text-sm text-white">{info}</div> : null}
      <div className="pt-2">
        <button className="pill-button" disabled={pending}>
          {pending ? "…" : button}
        </button>
      </div>
      {mode === "login" ? (
        <button type="button" className="block w-full text-xs text-white/75 hover:text-white" onClick={() => switchMode("reset")}>
          {t.forgot_password}
        </button>
      ) : null}
      <button
        type="button"
        className="block w-full text-sm font-semibold text-white hover:underline"
        onClick={() => switchMode(mode === "signup" ? "login" : mode === "reset" ? "login" : "signup")}
      >
        {mode === "login" ? t.no_account : t.have_account}
      </button>
    </form>
  );
}
