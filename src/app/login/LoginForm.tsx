"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type T = Record<
  | "login_title" | "signup_title" | "email" | "password" | "login_btn" | "signup_btn" | "have_account" | "no_account"
  | "check_email" | "already_registered" | "forgot_password" | "reset_title" | "reset_btn" | "reset_sent"
  | "invalid_login" | "email_not_confirmed" | "show_password" | "link_other_device"
  | "welcome_back" | "sub_back" | "sub_new" | "safe" | "err_busy" | "err_weak" | "err_generic",
  string
>;

type Mode = "login" | "signup" | "reset";

/** Set on this device after a successful sign-in: only someone who has been in before is welcomed back. */
const SEEN = "nuzul:signed-in-before";
const noSubscribe = () => () => {};
const readSeen = () => { try { return localStorage.getItem(SEEN) === "1"; } catch { return false; } };

export function LoginForm({ t, notice, initialMode = "login" }: { t: T; notice?: string; initialMode?: Mode }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(notice === "link" ? t.link_other_device : null);
  const [pending, setPending] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const returning = useSyncExternalStore(noSubscribe, readSeen, () => false);

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // Phones/iPads often capitalise the first letter: emails are case-insensitive
    const email = String(fd.get("email")).trim().toLowerCase();
    const password = String(fd.get("password") ?? "");
    const supabase = createClient();
    const callback = `${window.location.origin}/auth/callback`;
    setPending(true);
    setError(null);
    setInfo(null);

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setPending(false);
        if (error.code === "invalid_credentials") return setError(t.invalid_login);
        if (error.code === "email_not_confirmed") return setError(t.email_not_confirmed);
        return setError(/rate.?limit/i.test(`${error.code} ${error.message}`) ? t.err_busy : t.err_generic);
      }
      // One full navigation: the server sends the user straight to their home page (one request
      // instead of two client round trips), and the button keeps spinning until it opens.
      try { localStorage.setItem(SEEN, "1"); } catch { /* private mode: no greeting next time */ }
      // back to the page they asked for (only a page on this site), otherwise their home page
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.replace(next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/");
    } else if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: callback } });
      setPending(false);
      // plain words in the person's language, never the service's raw English message
      if (error) return setError(/rate.?limit/i.test(`${error.code} ${error.message}`) ? t.err_busy : error.code === "weak_password" ? t.err_weak : t.err_generic);
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
      if (error) return setError(/rate.?limit/i.test(`${error.code} ${error.message}`) ? t.err_busy : t.err_generic);
      setInfo(t.reset_sent);
    }
  }

  const title = mode === "login" ? (returning ? t.welcome_back : t.login_title) : mode === "signup" ? t.signup_title : t.reset_title;
  const button = mode === "login" ? t.login_btn : mode === "signup" ? t.signup_btn : t.reset_btn;
  const input = "w-full rounded-2xl border-[1.5px] border-[#e4e0d6] bg-white px-4 py-3 text-base outline-none transition focus:border-brand focus:shadow-[0_0_0_4px_#e3f1ee]";

  return (
    <form onSubmit={onSubmit} className="lp-rise w-full space-y-4">
      <div className="pb-2">
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {mode === "login" ? <p className="mt-2 text-[#66706c]">{returning ? t.sub_back : t.sub_new}</p> : null}
      </div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">{t.email}</span>
        <input name="email" type="email" required autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} dir="ltr" placeholder="name@hotel.om" className={input} />
      </label>
      {mode !== "reset" ? (
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">{t.password}</span>
          <input
            name="password"
            type={showPassword ? "text" : "password"}
            required
            minLength={8}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            dir="ltr"
            placeholder="••••••••"
            className={input}
          />
        </label>
      ) : null}
      {mode !== "reset" ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <label className="flex items-center gap-2 text-[#4d5753]">
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} className="size-4 accent-[#0d6b5f]" />
            {t.show_password}
          </label>
          {mode === "login" ? (
            <button type="button" className="font-semibold text-brand hover:underline" onClick={() => switchMode("reset")}>{t.forgot_password}</button>
          ) : null}
        </div>
      ) : null}
      {error ? <div role="alert" className="rounded-2xl bg-[#fdecea] px-4 py-3 text-sm font-semibold text-danger">{error}</div> : null}
      {info ? <div className="rounded-2xl bg-[#e3f1ee] px-4 py-3 text-sm font-semibold text-[#0a4f46]">{info}</div> : null}
      <button className="btn-primary min-h-13 w-full rounded-2xl text-base shadow-[0_12px_24px_-12px_rgba(13,107,95,0.8)]" disabled={pending}>
        {pending ? "…" : button}
      </button>
      <button
        type="button"
        className="block w-full text-center text-sm font-semibold text-brand hover:underline"
        onClick={() => switchMode(mode === "signup" ? "login" : mode === "reset" ? "login" : "signup")}
      >
        {mode === "login" ? t.no_account : t.have_account}
      </button>
      <p className="flex items-center gap-2 border-t border-[#e4e0d6] pt-4 text-xs text-[#66706c]">
        <span className="lp-pulse size-2 shrink-0 rounded-full bg-[#157f3b]" />{t.safe}
      </p>
    </form>
  );
}
