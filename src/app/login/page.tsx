import { getDict } from "@/lib/i18n/server";
import { LoginForm } from "./LoginForm";
import { LangToggle } from "@/components/LangToggle";
import { HotelIllustration } from "@/components/HotelIllustration";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { t, lang } = await getDict();
  const sp = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#e6efed] p-3 sm:p-8 dark:bg-bg">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[2rem] border-[6px] border-[#1c2321] bg-white shadow-[0_30px_80px_rgba(13,107,95,0.25)] md:grid-cols-2">
        {/* Branding panel */}
        <section className="relative hidden flex-col justify-between bg-white p-10 text-[#1c2321] md:flex">
          <div>
            <div className="brand-word text-6xl text-brand">{t.appName}</div>
            <div className="mt-1 text-sm text-[#66706c]">
              {lang === "ar" ? "لإدارة الفنادق والشقق الفندقية" : "Hotels & serviced apartments"}
            </div>
            <p className="mt-6 text-center text-xs text-[#66706c]">{lang === "ar" ? `«${t.tagline}»` : `“${t.tagline}”`}</p>
          </div>
          <HotelIllustration className="mx-auto my-6 w-full max-w-sm" />
          <div className="flex items-center justify-between text-xs text-[#66706c]">
            <span className="mx-auto block h-1 w-10 rounded-full bg-[#d9d4c8]" />
          </div>
          <div className="flex items-center justify-between text-[11px] text-[#66706c]">
            <span>© {new Date().getFullYear()} <span className="brand-word text-sm">{t.appName}</span></span>
            <span>{lang === "ar" ? "صُنع في عُمان" : "Made in Oman"}</span>
          </div>
        </section>

        {/* Form panel */}
        <section className="relative flex min-h-[560px] flex-col items-center justify-center overflow-hidden bg-brand px-6 py-10 text-white sm:px-12">
          <span className="pointer-events-none absolute -end-24 -top-24 h-64 w-64 rounded-full bg-white/10" />
          <span className="pointer-events-none absolute -bottom-28 -start-20 h-72 w-72 rounded-full bg-white/10" />
          <span className="pointer-events-none absolute end-10 top-10 h-3 w-3 rounded-full bg-[#f4c76b]" />
          <div className="absolute start-5 top-5 z-10">
            <LangToggle label={t.language} />
          </div>
          <div className="brand-word relative mb-2 text-5xl md:hidden">{t.appName}</div>
          {sp.reason === "idle" ? (
            <div className="relative mb-4 w-full max-w-xs rounded-2xl bg-white/15 px-3 py-2 text-center text-sm">{t.idle_logout}</div>
          ) : null}
        <LoginForm
          t={{
            login_title: t.login_title,
            signup_title: t.signup_title,
            email: t.email,
            password: t.password,
            login_btn: t.login_btn,
            signup_btn: t.signup_btn,
            have_account: t.have_account,
            no_account: t.no_account,
            check_email: t.check_email,
            already_registered: t.already_registered,
            forgot_password: t.forgot_password,
            reset_title: t.reset_title,
            reset_btn: t.reset_btn,
            reset_sent: t.reset_sent,
            invalid_login: t.invalid_login,
            email_not_confirmed: t.email_not_confirmed,
            show_password: t.show_password,
            link_other_device: t.link_other_device,
          }}
          notice={typeof sp.notice === "string" ? sp.notice : undefined}
        />
        </section>
      </div>
    </main>
  );
}
