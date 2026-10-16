import { getDict } from "@/lib/i18n/server";
import { LoginForm } from "./LoginForm";
import { LangToggle } from "@/components/LangToggle";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { t, lang } = await getDict();
  const sp = await searchParams;
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-brand p-10 text-brand-ink lg:flex">
        <div className="text-2xl font-bold">{t.appName}</div>
        <div>
          <p className="text-3xl font-bold leading-snug">{t.tagline}</p>
          <ul className="mt-6 space-y-2 text-sm opacity-90">
            <li>• {lang === "ar" ? "منع الحجز المزدوج على مستوى قاعدة البيانات" : "Double bookings prevented at the database level"}</li>
            <li>• {lang === "ar" ? "مسح الهوية وتصدير سجل النزلاء للشرطة" : "ID scanning and police guest-register export"}</li>
            <li>• {lang === "ar" ? "رسم السياحة والبلدية وضريبة القيمة المضافة تلقائياً" : "Tourism levy, municipality fee and VAT built in"}</li>
            <li>• {lang === "ar" ? "عقود شهرية وتحصيل ومتأخرات" : "Monthly contracts, collections and arrears"}</li>
          </ul>
        </div>
        <div className="text-xs opacity-70">© {new Date().getFullYear()} {t.appName}</div>
      </section>
      <section className="flex flex-col items-center justify-center p-6">
        <div className="mb-6 flex w-full max-w-sm items-center justify-between">
          <div className="text-xl font-bold text-brand lg:hidden">{t.appName}</div>
          <LangToggle label={t.language} />
        </div>
        {sp.reason === "idle" ? (
          <div className="mb-4 w-full max-w-sm rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{t.idle_logout}</div>
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
