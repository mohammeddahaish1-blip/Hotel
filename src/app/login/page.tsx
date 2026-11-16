import Link from "next/link";
import { getDict } from "@/lib/i18n/server";
import { LoginForm } from "./LoginForm";
import { LangToggle } from "@/components/LangToggle";
import { GoldLines, Phone } from "@/components/landing/Showcase";

const EXTRA = {
  ar: { err_busy: "طلبات كثيرة في وقت قصير. انتظر بضع دقائق ثم حاول مرة أخرى، أو تواصل معنا لنفتح لك الحساب.", err_weak: "كلمة المرور ضعيفة. اختر كلمة أطول فيها حروف وأرقام.", err_generic: "تعذّر إتمام الطلب الآن. حاول مرة أخرى بعد قليل.", welcome_back: "أهلاً بعودتك", sub_back: "ادخل لإدارة فندقك وشققك الفندقية.", sub_new: "ادخل بالبريد وكلمة المرور الخاصة بمنشأتك.", safe: "اتصال مشفّر، وبيانات كل منشأة معزولة عن غيرها.", tag: "لإدارة الفنادق والشقق الفندقية", head: "خمس محطات يمر بها كل نزيل", steps: ["الحجز", "الوصول", "الإقامة", "الدفع", "المغادرة"], alt: "لوحة حالة الوحدات في نُزُل على الجوال" },
  en: { err_busy: "Too many requests in a short time. Wait a few minutes and try again, or contact us and we will open the account for you.", err_weak: "That password is too weak. Choose a longer one with letters and numbers.", err_generic: "We could not complete that just now. Please try again shortly.", welcome_back: "Welcome back", sub_back: "Sign in to run your hotel and serviced apartments.", sub_new: "Sign in with your property's email and password.", safe: "Encrypted connection, and each company's data is kept apart.", tag: "Hotels & serviced apartments", head: "Five stops every guest passes", steps: ["Booking", "Arrival", "Stay", "Payment", "Departure"], alt: "The Nuzul units board on a phone" },
  ur: { err_busy: "کم وقت میں بہت زیادہ درخواستیں۔ چند منٹ انتظار کر کے دوبارہ کوشش کریں، یا ہم سے رابطہ کریں۔", err_weak: "پاس ورڈ کمزور ہے۔ حروف اور اعداد والا لمبا پاس ورڈ چنیں۔", err_generic: "ابھی یہ مکمل نہیں ہو سکا۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔", welcome_back: "خوش آمدید، دوبارہ", sub_back: "اپنے ہوٹل اور اپارٹمنٹس کے انتظام کے لیے داخل ہوں۔", sub_new: "اپنے ادارے کے ای میل اور پاس ورڈ سے داخل ہوں۔", safe: "محفوظ کنکشن، اور ہر ادارے کا ڈیٹا الگ رکھا جاتا ہے۔", tag: "ہوٹلوں اور سروسڈ اپارٹمنٹس کے لیے", head: "ہر مہمان کے پانچ مرحلے", steps: ["بکنگ", "آمد", "قیام", "ادائیگی", "روانگی"], alt: "فون پر نُزُل کا یونٹ بورڈ" },
  bn: { err_busy: "অল্প সময়ে অনেক অনুরোধ। কয়েক মিনিট অপেক্ষা করে আবার চেষ্টা করুন, অথবা আমাদের সাথে যোগাযোগ করুন।", err_weak: "পাসওয়ার্ডটি দুর্বল। অক্ষর ও সংখ্যা সহ লম্বা পাসওয়ার্ড বেছে নিন।", err_generic: "এখন এটি সম্পন্ন করা যায়নি। একটু পরে আবার চেষ্টা করুন।", welcome_back: "আবার স্বাগতম", sub_back: "আপনার হোটেল ও অ্যাপার্টমেন্ট পরিচালনা করতে প্রবেশ করুন।", sub_new: "আপনার প্রতিষ্ঠানের ইমেইল ও পাসওয়ার্ড দিয়ে প্রবেশ করুন।", safe: "এনক্রিপ্টেড সংযোগ, এবং প্রতিটি প্রতিষ্ঠানের ডেটা আলাদা রাখা হয়।", tag: "হোটেল ও সার্ভিসড অ্যাপার্টমেন্টের জন্য", head: "প্রতিটি অতিথির পাঁচটি ধাপ", steps: ["বুকিং", "আগমন", "অবস্থান", "পেমেন্ট", "প্রস্থান"], alt: "ফোনে নুজুলের ইউনিট বোর্ড" },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const x = EXTRA[lang];
  return (
    <main className="grid min-h-screen bg-white text-[#1c2321] md:grid-cols-[minmax(22rem,0.9fr)_1.1fr]">
      {/* Form panel */}
      <section className="flex min-h-screen flex-col px-6 py-6 sm:px-12 lg:px-20">
        <div className="flex items-center justify-between">
          <Link href="/" className="brand-word text-5xl text-brand" aria-label={t.appName}>{t.appName}</Link>
          <LangToggle current={lang} />
        </div>
        <div className="my-auto w-full max-w-sm py-10">
          {sp.reason === "idle" ? (
            <div className="mb-5 rounded-2xl bg-[#fbf1d6] px-4 py-3 text-sm font-semibold text-[#6b4a00]">{t.idle_logout}</div>
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
              welcome_back: x.welcome_back,
              sub_back: x.sub_back,
              sub_new: x.sub_new,
              safe: x.safe,
              err_busy: x.err_busy,
              err_weak: x.err_weak,
              err_generic: x.err_generic,
            }}
            notice={typeof sp.notice === "string" ? sp.notice : undefined}
            initialMode={sp.mode === "signup" ? "signup" : "login"}
          />
        </div>
        <p className="text-xs text-[#66706c]">{x.tag}</p>
      </section>

      {/* The product, alive */}
      <section className="relative hidden place-items-center overflow-hidden bg-[#083f39] p-10 text-white md:grid" aria-hidden>
        <div className="lp2-glow" style={{ background: "radial-gradient(circle, #17806f 0, transparent 68%)", width: 560, height: 560 }} />
        <GoldLines id="lg" />
        <div className="relative grid items-center gap-9 lg:grid-cols-[auto_1fr]">
          <Phone src="/landing/board.jpg" alt={x.alt} tilt={-4} className="mx-auto scale-90 lg:scale-100" />
          <div className="hidden lg:block">
            <h2 className="mb-5 text-3xl font-bold leading-snug">{x.head}</h2>
            <ol className="grid gap-2.5">
              {x.steps.map((s, i) => (
                <li key={s} className={`lp2-step flex items-center gap-2.5 rounded-2xl border px-4 py-2.5 font-semibold ${i === 4 ? "border-[#d9a531] bg-[#d9a531] text-[#3a2a00]" : "border-white/15 bg-white/10"}`} style={{ ["--i" as string]: i }}>
                  <span className="num grid size-6 place-items-center rounded-full bg-white/20 text-xs">{i + 1}</span>{s}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>
    </main>
  );
}
