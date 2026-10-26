import { getDict } from "@/lib/i18n/server";
import { LoginForm } from "./LoginForm";
import { LangToggle } from "@/components/LangToggle";
import { HotelIllustration } from "@/components/HotelIllustration";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { t, lang } = await getDict();
  const sp = await searchParams;
  return (
    <main className="grid min-h-screen bg-white md:grid-cols-2">
        {/* Branding panel */}
        <section className="relative hidden flex-col bg-white p-10 text-[#1c2321] md:flex lg:p-14">
          <div>
            <div className="brand-word text-7xl text-brand lg:text-8xl">{t.appName}</div>
            <div className="mt-2 text-lg text-[#66706c]">
              {{ ar: "لإدارة الفنادق والشقق الفندقية", en: "Hotels & serviced apartments", ur: "ہوٹلوں اور سروسڈ اپارٹمنٹس کے لیے" }[lang]}
            </div>
          </div>
          <div className="flex flex-1 items-end justify-center pb-6">
            <HotelIllustration className="w-full max-w-xl" />
          </div>
        </section>

        {/* Form panel */}
        <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-brand px-6 py-10 text-white sm:px-12">
          <span className="pointer-events-none absolute -end-24 -top-24 h-64 w-64 rounded-full bg-white/10" />
          <span className="pointer-events-none absolute -bottom-28 -start-20 h-72 w-72 rounded-full bg-white/10" />
          <span className="pointer-events-none absolute end-10 top-10 h-3 w-3 rounded-full bg-[#f4c76b]" />
          <div className="absolute start-5 top-5 z-10">
            <LangToggle current={lang} />
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
    </main>
  );
}
