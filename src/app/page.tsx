import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BedDouble, CalendarRange, Check, ClipboardCheck, FileText, KeyRound, LifeBuoy, MessageCircle, Receipt, ShieldCheck, Wrench,
} from "lucide-react";
import { getCtx, homeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getDict } from "@/lib/i18n/server";
import { LangToggle } from "@/components/LangToggle";
import { HotelIllustration } from "@/components/HotelIllustration";
import { SubmitButton } from "@/components/ActionForm";
import { startDemo } from "@/app/actions/demo";

type PlanRow = { code: string; name_ar: string; name_en: string | null; monthly_price: number; max_units: number | null; max_properties: number | null; features: string[] };

const COPY = {
  ar: {
    login: "تسجيل الدخول",
    title: "أدِر فندقك وشققك الفندقية من مكان واحد",
    sub: "نظام عربي صُمّم لعُمان: الحجوزات والاستقبال، التنظيف والصيانة، الفواتير والرسوم الحكومية، والتقارير — من الكمبيوتر أو الآيباد أو الجوال.",
    demo: "جرّب النظام الآن",
    demoNote: "بدون تسجيل — فندق تجريبي ببيانات وهمية",
    trial: "ابدأ شهرك المجاني",
    trialNote: "الشهر الأول مجاناً على الباقة الشاملة، بدون بطاقة دفع",
    unavailable: "العرض التجريبي غير متاح الآن، حاول بعد قليل.",
    featuresTitle: "كل ما يحتاجه يومك في الفندق",
    features: [
      [CalendarRange, "الوحدات والتقويم", "حالة كل غرفة وشقة لحظة بلحظة، والحجز مباشرة من التقويم دون حجز مزدوج."],
      [KeyRound, "الاستقبال والنزلاء", "تسجيل الوصول بقراءة البطاقة المدنية أو الجواز، وسجل كامل لكل نزيل."],
      [Receipt, "الفواتير والرسوم", "رسوم السياحة والبلدية وضريبة القيمة المضافة تُحسب تلقائياً، وسندات قبض مرقّمة."],
      [FileText, "الإيجار الشهري والعقود", "عقود الشقق وجدول الدفعات والشيكات المؤجلة، مع تنبيه قبل انتهاء العقد."],
      [Wrench, "التنظيف والصيانة", "مهام تنظيف لكل غرفة، وبلاغات أعطال تمنع حجز الوحدة حتى تُصلح."],
      [MessageCircle, "القنوات وواتساب", "ربط تقويم Booking وAirbnb، ورسائل واتساب جاهزة للتأكيد والتذكير."],
      [ClipboardCheck, "التقارير والإقفال اليومي", "الإيراد والإشغال والمصروفات، وإقفال نهاية اليوم بلا حجوزات معلّقة."],
      [ShieldCheck, "الصلاحيات وسجل العمليات", "لكل موظف ما يخصه فقط، وكل تعديل مسجّل باسم من قام به ومتى."],
      [LifeBuoy, "دعم يحترم خصوصيتك", "لا يدخل فريق نُزُل نظامك إلا بإذنك ولمدة تحددها، وترى كل ما فعله."],
    ] as const,
    plansTitle: "باقات واضحة، والشهر الأول مجاناً",
    plansSub: "تبدأ كل شركة بشهر مجاني كامل على الباقة الشاملة، ثم تختار الباقة التي تناسبها. لا يُخصم شيء تلقائياً.",
    perMonth: "شهرياً",
    units: (n: number | null) => (n ? `حتى ${n} وحدة` : "وحدات غير محدودة"),
    props: (n: number | null) => (n == null ? "عقارات غير محدودة" : n === 1 ? "عقار واحد" : `حتى ${n} عقار`),
    core: "كل أساسيات التشغيل: الحجوزات، الاستقبال، الفواتير، التنظيف، الصيانة، التقارير",
    choose: "ابدأ مجاناً",
    faqTitle: "أسئلة شائعة",
    faq: [
      ["هل أحتاج لتثبيت أي برنامج؟", "لا. يعمل نُزُل من المتصفح على الكمبيوتر والآيباد والجوال، ويمكن إضافته للشاشة الرئيسية كتطبيق."],
      ["هل بياناتي آمنة؟", "بيانات كل شركة معزولة تماماً، وكل عملية مسجّلة باسم من قام بها، ولا يصل فريقنا لبياناتك إلا بإذن منك ولوقت محدد."],
      ["ماذا يحدث بعد الشهر المجاني؟", "تختار الباقة المناسبة وتدفع شهرياً. إن لم تشترك لا يُخصم منك شيء."],
      ["هل يناسب الشقق الفندقية والإيجار الشهري؟", "نعم: عقود شهرية، جدول دفعات، شيكات مؤجلة، وكشوف لملاك الوحدات."],
    ] as const,
    footer: "نظام عربي لإدارة الفنادق والشقق الفندقية — صُنع في عُمان",
  },
  en: {
    login: "Sign in",
    title: "Run your hotel and serviced apartments from one place",
    sub: "An Arabic-first system built for Oman: bookings and front desk, housekeeping and maintenance, invoices and government fees, and reports — on a computer, iPad or phone.",
    demo: "Try it now",
    demoNote: "No sign-up — a sample hotel with made-up data",
    trial: "Start your free month",
    trialNote: "First month free on the full plan, no card needed",
    unavailable: "The demo is not available right now, please try again shortly.",
    featuresTitle: "Everything your hotel's day needs",
    features: [
      [CalendarRange, "Units and calendar", "Every room and apartment's status in real time, and booking straight from the calendar with no double bookings."],
      [KeyRound, "Front desk and guests", "Check-in by reading the civil ID or passport, and a full history for every guest."],
      [Receipt, "Invoices and fees", "Tourism levy, municipality fee and VAT worked out for you, with numbered receipts."],
      [FileText, "Monthly rentals and contracts", "Apartment contracts, payment schedules and post-dated cheques, with a reminder before a contract ends."],
      [Wrench, "Housekeeping and maintenance", "Cleaning tasks per room, and fault reports that keep a unit off sale until it is fixed."],
      [MessageCircle, "Channels and WhatsApp", "Booking and Airbnb calendar sync, and ready WhatsApp messages for confirmations and reminders."],
      [ClipboardCheck, "Reports and daily close", "Revenue, occupancy and expenses, and an end-of-day close with nothing left pending."],
      [ShieldCheck, "Permissions and activity log", "Each employee sees only their part, and every change is logged with who did it and when."],
      [LifeBuoy, "Support that respects your privacy", "The Nuzul team only enters your system with your permission, for a time you set, and you see what they did."],
    ] as const,
    plansTitle: "Clear plans, first month free",
    plansSub: "Every company starts with a full free month on the complete plan, then picks the plan that fits. Nothing is charged automatically.",
    perMonth: "per month",
    units: (n: number | null) => (n ? `Up to ${n} units` : "Unlimited units"),
    props: (n: number | null) => (n == null ? "Unlimited properties" : n === 1 ? "One property" : `Up to ${n} properties`),
    core: "All the essentials: bookings, front desk, invoices, housekeeping, maintenance, reports",
    choose: "Start free",
    faqTitle: "Questions",
    faq: [
      ["Do I need to install anything?", "No. Nuzul runs in the browser on a computer, iPad or phone, and can be added to the home screen like an app."],
      ["Is my data safe?", "Each company's data is fully separated, every action is logged with who did it, and our team reaches your data only with your permission and for a set time."],
      ["What happens after the free month?", "You choose a plan and pay monthly. If you don't subscribe, nothing is charged."],
      ["Does it suit serviced apartments and monthly rentals?", "Yes: monthly contracts, payment schedules, post-dated cheques and statements for unit owners."],
    ] as const,
    footer: "Arabic-first hotel and serviced-apartment management — made in Oman",
  },
};

const FEATURE_NAMES: Record<string, [string, string]> = {
  messages: ["رسائل واتساب للنزلاء", "WhatsApp guest messages"], automation: ["الأتمتة", "Automation"],
  payment_links: ["روابط الدفع", "Payment links"], contracts: ["العقود الإلكترونية والتوقيع", "E-contracts and signing"],
  channels: ["ربط القنوات (Booking / Airbnb)", "Channel sync (Booking / Airbnb)"], analytics: ["التحليلات", "Analytics"],
  import: ["استيراد البيانات", "Data import"], owners: ["كشوف ملاك الوحدات", "Unit owner statements"],
  assistant: ["المساعد الذكي", "AI assistant"], multi_property: ["تعدد العقارات", "Multiple properties"],
};

/** Whole riyals for prices (baisa in the database): "15", or "12.5" for a non-round price */
const riyals = (baisa: number) => String(Number((baisa / 1000).toFixed(3)));

function DemoButton({ label, light = false }: { label: string; light?: boolean }) {
  return (
    <form action={startDemo}>
      <SubmitButton className={light ? "btn bg-white px-5 text-brand hover:bg-white/90" : "btn-primary px-5"}>{label}</SubmitButton>
    </form>
  );
}

/** Visitors see the product page; signed-in staff go straight to their home page. */
export default async function Home({ searchParams }: PageProps<"/">) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims) {
    const ctx = await getCtx();
    redirect(homeFor(ctx));
  }
  const { lang } = await getDict();
  const en = lang === "en" || lang === "bn";   // Bengali visitors read the English page
  const c = en ? COPY.en : COPY.ar;
  const sp = await searchParams;
  const { data } = await supabase.from("plans").select("code, name_ar, name_en, monthly_price, max_units, max_properties, features").eq("active", true).order("sort");
  const plans = (data ?? []) as PlanRow[];


  return (
    <div className="min-h-screen bg-white text-[#1c2321]">
      <header className="border-b border-[#e6e9e7]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 lg:px-8">
          <span className="brand-word text-4xl text-brand">نُزُل</span>
          <div className="flex items-center gap-2">
            <LangToggle current={lang} />
            <Link href="/login" className="btn-ghost btn-sm">{c.login}</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-12 lg:grid-cols-2 lg:px-8 lg:py-20">
          <div>
            <h1 className="text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">{c.title}</h1>
            <p className="mt-4 max-w-xl text-lg leading-relaxed text-[#4d5753]">{c.sub}</p>
            {sp.demo === "unavailable" ? <p role="alert" className="mt-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{c.unavailable}</p> : null}
            <div className="mt-7 flex flex-wrap items-start gap-3">
              <div>
                <DemoButton label={c.demo} />
                <p className="mt-1.5 text-xs text-[#66706c]">{c.demoNote}</p>
              </div>
              <div>
                <Link href="/login?mode=signup" className="btn-ghost px-5">{c.trial}</Link>
                <p className="mt-1.5 text-xs text-[#66706c]">{c.trialNote}</p>
              </div>
            </div>
          </div>
          <HotelIllustration className="mx-auto w-full max-w-lg" />
        </section>

        <section className="border-y border-[#e6e9e7] bg-[#f7f8f6]">
          <div className="mx-auto max-w-6xl px-4 py-14 lg:px-8">
            <h2 className="text-2xl font-bold sm:text-3xl">{c.featuresTitle}</h2>
            <div className="mt-8 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {c.features.map(([Icon, title, body]) => (
                <div key={title} className="flex gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-5" aria-hidden /></span>
                  <div>
                    <h3 className="font-bold">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-[#4d5753]">{body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 lg:px-8" id="plans">
          <h2 className="text-2xl font-bold sm:text-3xl">{c.plansTitle}</h2>
          <p className="mt-2 max-w-2xl text-[#4d5753]">{c.plansSub}</p>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {plans.map((p, i) => (
              <div key={p.code} className={`flex flex-col rounded-2xl border p-6 ${i === plans.length - 1 ? "border-brand" : "border-[#e6e9e7]"}`}>
                <h3 className="text-lg font-bold">{en ? p.name_en ?? p.name_ar : p.name_ar}</h3>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span className="num text-3xl font-bold">{en ? `OMR ${riyals(p.monthly_price)}` : `${riyals(p.monthly_price)} ر.ع.`}</span>
                  <span className="text-sm text-[#66706c]">{c.perMonth}</span>
                </div>
                <ul className="mt-5 flex-1 space-y-2 text-sm">
                  {[c.units(p.max_units), c.props(p.max_properties), c.core, ...p.features.filter((f) => f !== "multi_property").map((f) => FEATURE_NAMES[f]?.[en ? 1 : 0] ?? f)].map((line) => (
                    <li key={line} className="flex items-start gap-2"><Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />{line}</li>
                  ))}
                </ul>
                <Link href="/login?mode=signup" className={`${i === plans.length - 1 ? "btn-primary" : "btn-ghost"} mt-6 w-full`}>{c.choose}</Link>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-brand text-white">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-4 px-4 py-12 sm:flex-row sm:items-center sm:justify-between lg:px-8">
            <div className="flex items-center gap-3">
              <BedDouble className="size-8 shrink-0 opacity-80" aria-hidden />
              <p className="text-lg font-semibold">{c.demoNote}</p>
            </div>
            <DemoButton label={c.demo} light />
          </div>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-14 lg:px-8">
          <h2 className="text-2xl font-bold">{c.faqTitle}</h2>
          <div className="mt-6 divide-y divide-[#e6e9e7] border-y border-[#e6e9e7]">
            {c.faq.map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="cursor-pointer list-none font-semibold">{q}</summary>
                <p className="mt-2 text-sm leading-relaxed text-[#4d5753]">{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-[#e6e9e7]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-[#66706c] lg:px-8">
          <span><span className="brand-word text-xl text-brand">نُزُل</span> · {c.footer}</span>
          <Link href="/login" className="hover:text-brand">{c.login}</Link>
        </div>
      </footer>
    </div>
  );
}
